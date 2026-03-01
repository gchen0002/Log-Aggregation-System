#pragma once

#include <string>
#include <optional>
#include <chrono>

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
    
    std::optional<LogEntry> parse(const std::string& line);
    
private:
    std::optional<LogEntry> parseJson(const std::string& line);
    std::optional<LogEntry> parsePlainText(const std::string& line);
};

}  // namespace log_agent
