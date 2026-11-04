#include "log_parser.hpp"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <nlohmann/json.hpp>
#include <sstream>
#include <unordered_map>

namespace log_agent {

namespace {
// Static level map - created once
const std::unordered_map<std::string, std::string> &getLevelMap() {
    static const std::unordered_map<std::string, std::string> kLevelMap = {
        {"error", "error"},      {"err", "error"},   {"fatal", "error"},  {"critical", "error"},
        {"severe", "error"},     {"warn", "warn"},   {"warning", "warn"}, {"info", "info"},
        {"information", "info"}, {"notice", "info"}, {"debug", "debug"},  {"trace", "debug"},
        {"verbose", "debug"}};
    return kLevelMap;
}

// Case-insensitive search helper
bool containsIgnoreCase(std::string_view haystack, std::string_view needle) {
    if (needle.size() > haystack.size())
        return false;
    auto it = std::search(haystack.begin(), haystack.end(), needle.begin(), needle.end(),
                          [](unsigned char ch1, unsigned char ch2) {
                              return std::tolower(ch1) == std::tolower(ch2);
                          });
    return it != haystack.end();
}
} // namespace

std::optional<LogEntry> LogParser::parse(const std::string &line) const {
    // Skip empty lines
    if (line.empty() ||
        std::all_of(line.begin(), line.end(), [](unsigned char c) { return std::isspace(c); })) {
        return std::nullopt;
    }

    // Try JSON first
    if (auto jsonResult = parseJson(line)) {
        return jsonResult;
    }

    // Fall back to plain text
    return parsePlainText(line);
}

void LogParser::normalizeJson(nlohmann::json &entry) const {
    if (!entry.is_object())
        return;
    const auto alias = [&](const char *canonical, std::initializer_list<const char *> names) {
        if (entry.contains(canonical) && !entry[canonical].is_null())
            return;
        for (const auto *name : names) {
            if (entry.contains(name) && !entry[name].is_null()) {
                entry[canonical] = entry[name];
                return;
            }
        }
    };
    alias("message", {"msg", "text"});
    alias("level", {"severity", "log_level"});
    alias("source", {"service", "app"});
    alias("timestamp", {"time", "ts"});
    if (entry.contains("level")) {
        auto &level = entry["level"];
        if (level.is_number_integer()) {
            const auto n = level.get<long long>();
            level = n == 0 ? "debug" : n == 2 ? "warn" : n == 3 ? "error" : "info";
        } else if (level.is_string()) {
            level = normalizeLevel(level.get_ref<const std::string &>());
        }
    }
    if (entry.contains("timestamp")) {
        auto &timestamp = entry["timestamp"];
        if (timestamp.is_number()) {
            const double value = timestamp.get<double>();
            // The worker consumes milliseconds. Keep ISO strings intact so their
            // fractional seconds and UTC offsets survive normalization.
            if (value > -1000000000000.0 && value < 1000000000000.0)
                timestamp = value * 1000.0;
        } else if (timestamp.is_string()) {
            const auto &text = timestamp.get_ref<const std::string &>();
            if (!text.empty() && std::all_of(text.begin(), text.end(),
                                             [](unsigned char c) { return std::isdigit(c); })) {
                timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                                parseTimestamp(text).time_since_epoch())
                                .count();
            }
        }
    }
}

std::optional<LogEntry> LogParser::parseJson(const std::string &line) const {
    try {
        auto j = nlohmann::json::parse(line);
        normalizeJson(j);
        if (!j.is_object() || !j.contains("message") || !j.contains("level"))
            return std::nullopt;
        LogEntry entry;
        entry.raw = line;
        entry.message = j.at("message").get<std::string>();
        entry.level = j.at("level").get<std::string>();
        entry.source = j.contains("source") && !j["source"].is_null()
                           ? j["source"].get<std::string>()
                           : "unknown";
        if (j.contains("timestamp") && j["timestamp"].is_number())
            entry.timestamp = std::chrono::system_clock::time_point(
                std::chrono::milliseconds(j["timestamp"].get<long long>()));
        else if (j.contains("timestamp") && j["timestamp"].is_string())
            entry.timestamp = parseTimestamp(j["timestamp"].get<std::string>());
        else
            entry.timestamp = std::chrono::system_clock::now();
        return entry;
    } catch (const nlohmann::json::exception &) {
        return std::nullopt;
    }
}

std::optional<LogEntry> LogParser::parsePlainText(const std::string &line) const {
    LogEntry entry;
    entry.raw = line;
    entry.timestamp = std::chrono::system_clock::now();
    entry.source = "plain_text";

    // Case-insensitive level detection without copying
    entry.level = detectLevel(line);
    entry.message = line;

    return entry;
}

std::string LogParser::normalizeLevel(const std::string &level) {
    // Convert to lowercase for consistency
    std::string lower = level;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return std::tolower(c); });

    const auto &kLevelMap = getLevelMap();
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

std::chrono::system_clock::time_point LogParser::parseTimestamp(const std::string &ts) {
    // Check for Unix timestamp (all digits)
    if (!ts.empty() &&
        std::all_of(ts.begin(), ts.end(), [](unsigned char c) { return std::isdigit(c); })) {
        // Validate length to prevent overflow/performance issues
        if (ts.length() > 20) {
            return std::chrono::system_clock::now();
        }
        try {
            long long timestamp = std::stoll(ts);
            if (ts.length() > 10) {
                // Milliseconds
                return std::chrono::system_clock::time_point(std::chrono::milliseconds(timestamp));
            } else {
                // Seconds
                return std::chrono::system_clock::time_point(std::chrono::seconds(timestamp));
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
    tt = _mkgmtime(&tm); // Windows UTC version
#else
    tt = timegm(&tm); // Unix UTC version
#endif

    if (tt == -1) {
        return std::chrono::system_clock::now();
    }

    auto tp = std::chrono::system_clock::from_time_t(tt);

    // Handle milliseconds if present (.123)
    if (ss.peek() == '.') {
        ss.ignore(); // Skip '.'
        std::string msStr;
        ss >> msStr; // Read the rest as string

        if (!msStr.empty()) {
            // Pad or truncate to 3 digits (milliseconds)
            while (msStr.length() < 3)
                msStr += '0';
            if (msStr.length() > 3)
                msStr = msStr.substr(0, 3);

            try {
                int ms = std::stoi(msStr);
                tp += std::chrono::milliseconds(ms);
            } catch (...) {
                // Ignore milliseconds on parse failure
            }
        }
    }

    return tp;
}

} // namespace log_agent
