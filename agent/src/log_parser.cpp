#include "log_parser.hpp"
#include <nlohmann/json.hpp>
#include <chrono>
#include <algorithm>
#include <cctype>
#include <sstream>
#include <iomanip>
#include <unordered_map>
#include <ctime>

namespace log_agent {

namespace {
    // Static level map - created once
    const std::unordered_map<std::string, std::string>& getLevelMap() {
        static const std::unordered_map<std::string, std::string> kLevelMap = {
            {"error", "error"}, {"err", "error"}, {"fatal", "error"}, 
            {"critical", "error"}, {"severe", "error"},
            {"warn", "warn"}, {"warning", "warn"},
            {"info", "info"}, {"information", "info"}, {"notice", "info"},
            {"debug", "debug"}, {"trace", "debug"}, {"verbose", "debug"}
        };
        return kLevelMap;
    }
    
    // Case-insensitive search helper
    bool containsIgnoreCase(std::string_view haystack, std::string_view needle) {
        if (needle.size() > haystack.size()) return false;
        auto it = std::search(
            haystack.begin(), haystack.end(),
            needle.begin(), needle.end(),
            [](unsigned char ch1, unsigned char ch2) { 
                return std::tolower(ch1) == std::tolower(ch2); 
            }
        );
        return it != haystack.end();
    }
}

std::optional<LogEntry> LogParser::parse(const std::string& line) const {
    // Skip empty lines
    if (line.empty() || std::all_of(line.begin(), line.end(), ::isspace)) {
        return std::nullopt;
    }
    
    // Try JSON first
    if (auto jsonResult = parseJson(line)) {
        return jsonResult;
    }
    
    // Fall back to plain text
    return parsePlainText(line);
}

std::optional<LogEntry> LogParser::parseJson(const std::string& line) const {
    try {
        // Parse with nlohmann/json - handles all edge cases
        auto j = nlohmann::json::parse(line);
        
        LogEntry entry;
        entry.raw = line;
        
        // Extract level (supports multiple field names and types)
        std::string levelStr;
        if (j.contains("level") && !j["level"].is_null()) {
            if (j["level"].is_string()) {
                levelStr = j["level"].get<std::string>();
            } else if (j["level"].is_number_integer()) {
                // Map numeric levels: 0=debug, 1=info, 2=warn, 3=error
                int levelNum = j["level"].get<int>();
                switch (levelNum) {
                    case 0: levelStr = "debug"; break;
                    case 1: levelStr = "info"; break;
                    case 2: levelStr = "warn"; break;
                    case 3: levelStr = "error"; break;
                    default: levelStr = "info";
                }
            }
        } else if (j.contains("severity") && !j["severity"].is_null()) {
            levelStr = j["severity"].get<std::string>();
        } else if (j.contains("log_level") && !j["log_level"].is_null()) {
            levelStr = j["log_level"].get<std::string>();
        } else {
            return std::nullopt;  // Required field missing
        }
        entry.level = normalizeLevel(levelStr);
        
        // Extract message (handle nulls)
        if (j.contains("message") && !j["message"].is_null()) {
            entry.message = j["message"].get<std::string>();
        } else if (j.contains("msg") && !j["msg"].is_null()) {
            entry.message = j["msg"].get<std::string>();
        } else if (j.contains("text") && !j["text"].is_null()) {
            entry.message = j["text"].get<std::string>();
        } else {
            return std::nullopt;  // Required field missing
        }
        
        // Optional: source
        if (j.contains("source") && !j["source"].is_null()) {
            entry.source = j["source"].get<std::string>();
        } else if (j.contains("service") && !j["service"].is_null()) {
            entry.source = j["service"].get<std::string>();
        } else if (j.contains("app") && !j["app"].is_null()) {
            entry.source = j["app"].get<std::string>();
        } else {
            entry.source = "unknown";
        }
        
        // Optional: timestamp from log (if present)
        if (j.contains("timestamp") && !j["timestamp"].is_null()) {
            if (j["timestamp"].is_number()) {
                // Unix timestamp (milliseconds or seconds)
                auto ts = j["timestamp"].get<long long>();
                if (ts > 1000000000000LL) {  // Milliseconds (13+ digits)
                    entry.timestamp = std::chrono::system_clock::time_point(
                        std::chrono::milliseconds(ts));
                } else {  // Seconds (10 digits)
                    entry.timestamp = std::chrono::system_clock::time_point(
                        std::chrono::seconds(ts));
                }
            } else if (j["timestamp"].is_string()) {
                entry.timestamp = parseTimestamp(j["timestamp"].get<std::string>());
            } else {
                entry.timestamp = std::chrono::system_clock::now();
            }
        } else if (j.contains("time") && !j["time"].is_null()) {
            entry.timestamp = parseTimestamp(j["time"].get<std::string>());
        } else if (j.contains("ts") && !j["ts"].is_null()) {
            entry.timestamp = parseTimestamp(j["ts"].get<std::string>());
        } else {
            entry.timestamp = std::chrono::system_clock::now();
        }
        
        return entry;
        
    } catch (const nlohmann::json::exception&) {
        // Not valid JSON
        return std::nullopt;
    }
}

std::optional<LogEntry> LogParser::parsePlainText(const std::string& line) const {
    LogEntry entry;
    entry.raw = line;
    entry.timestamp = std::chrono::system_clock::now();
    entry.source = "plain_text";
    
    // Case-insensitive level detection without copying
    entry.level = detectLevel(line);
    entry.message = line;
    
    return entry;
}

std::string LogParser::normalizeLevel(const std::string& level) {
    // Convert to lowercase for consistency
    std::string lower = level;
    std::transform(lower.begin(), lower.end(), lower.begin(), 
                   [](unsigned char c) { return std::tolower(c); });
    
    const auto& kLevelMap = getLevelMap();
    auto it = kLevelMap.find(lower);
    return (it != kLevelMap.end()) ? it->second : "info";
}

std::string LogParser::detectLevel(std::string_view line) {
    // Check for severe errors first (order matters!)
    if (containsIgnoreCase(line, "fatal")) {
        return "error";
    }
    if (containsIgnoreCase(line, "critical")) {
        return "error";
    }
    if (containsIgnoreCase(line, "severe")) {
        return "error";
    }
    if (containsIgnoreCase(line, "error")) {
        return "error";
    }
    if (containsIgnoreCase(line, "warn")) {
        return "warn";
    }
    if (containsIgnoreCase(line, "debug")) {
        return "debug";
    }
    if (containsIgnoreCase(line, "trace")) {
        return "debug";
    }
    
    return "info";
}

std::chrono::system_clock::time_point LogParser::parseTimestamp(const std::string& ts) {
    // Check for Unix timestamp (all digits)
    if (!ts.empty() && std::all_of(ts.begin(), ts.end(), ::isdigit)) {
        try {
            long long timestamp = std::stoll(ts);
            if (ts.length() > 10) {
                // Milliseconds
                return std::chrono::system_clock::time_point(
                    std::chrono::milliseconds(timestamp));
            } else {
                // Seconds
                return std::chrono::system_clock::time_point(
                    std::chrono::seconds(timestamp));
            }
        } catch (...) {
            return std::chrono::system_clock::now();
        }
    }
    
    // Try ISO8601 format: "2024-03-01T10:30:00Z" or "2024-03-01T10:30:00.000Z"
    std::tm tm = {};
    std::istringstream ss(ts);
    
    // Parse main datetime (up to seconds)
    ss >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
    
    if (ss.fail()) {
        // Try space-separated format: "2024-03-01 10:30:00"
        std::istringstream ss2(ts);
        ss2 >> std::get_time(&tm, "%Y-%m-%d %H:%M:%S");
        
        if (ss2.fail()) {
            return std::chrono::system_clock::now();
        }
    }
    
    // Convert to time_t (assumes UTC for Z suffix, local otherwise)
    // Note: timegm() is non-standard but widely available
    // For strict C++17 portability, we'd need to handle timezone manually
    time_t tt;
    #ifdef _WIN32
        tt = _mkgmtime(&tm);  // Windows UTC version
    #else
        tt = timegm(&tm);     // Unix UTC version
    #endif
    
    if (tt == -1) {
        return std::chrono::system_clock::now();
    }
    
    auto tp = std::chrono::system_clock::from_time_t(tt);
    
    // Handle milliseconds if present (.123)
    if (ss.peek() == '.') {
        ss.ignore();  // Skip '.'
        std::string msStr;
        ss >> msStr;  // Read the rest as string
        
        if (!msStr.empty()) {
            // Pad or truncate to 3 digits (milliseconds)
            while (msStr.length() < 3) msStr += '0';
            if (msStr.length() > 3) msStr = msStr.substr(0, 3);
            
            int ms = std::stoi(msStr);
            tp += std::chrono::milliseconds(ms);
        }
    }
    
    return tp;
}

}  // namespace log_agent
