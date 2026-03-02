#pragma once

#include <string>
#include <optional>
#include <chrono>
#include <string_view>

namespace log_agent {

struct LogEntry {
    std::string message;
    std::string level;
    std::string source;
    std::chrono::system_clock::time_point timestamp;
    std::optional<std::string> raw;
};

class LogParser {
public:
    LogParser() = default;
    
    std::optional<LogEntry> parse(const std::string& line) const;
    
private:
    std::optional<LogEntry> parseJson(const std::string& line) const;
    std::optional<LogEntry> parsePlainText(const std::string& line) const;
    
    static std::string normalizeLevel(const std::string& level);
    static std::string detectLevel(std::string_view line);
    static std::chrono::system_clock::time_point parseTimestamp(const std::string& ts);
};

}  // namespace log_agent
