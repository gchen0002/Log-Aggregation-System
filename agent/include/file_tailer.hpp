#pragma once

#include <string>
#include <functional>
#include <thread>
#include <atomic>

namespace log_agent {

class FileTailer {
public:
    using Callback = std::function<void(const std::string& line)>;
    
    explicit FileTailer(const std::string& filepath, Callback callback);
    ~FileTailer();
    
    void start();
    void stop();
    
private:
    void run();
    
    std::string filepath_;
    Callback callback_;
    std::thread thread_;
    std::atomic<bool> running_{false};
};

}  // namespace log_agent
