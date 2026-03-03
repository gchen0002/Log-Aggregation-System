#pragma once

#include <string>
#include <vector>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <functional>
#include <chrono>

namespace log_agent {

class Batcher {
public:
    using BatchCallback = std::function<void(const std::vector<std::string>&)>;
    
    Batcher(size_t batchSize, std::chrono::milliseconds flushInterval, BatchCallback callback);
    ~Batcher();
    
    void add(const std::string& item);
    void add(std::string&& item);
    void flush();
    
private:
    void runFlusher();
    
    size_t batch_size_;
    std::chrono::milliseconds flush_interval_;
    BatchCallback callback_;
    
    std::queue<std::string> items_;
    std::mutex mutex_;
    std::condition_variable cv_;
    std::thread flusher_thread_;
    std::atomic<bool> running_{true};
};

}  // namespace log_agent
