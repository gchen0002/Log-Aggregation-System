#pragma once

#include <string>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <functional>

namespace log_queue {

struct Message {
    std::string id;
    std::string content;
    int64_t timestamp;
};

class Queue {
public:
    explicit Queue(size_t maxSize = 10000);
    ~Queue() = default;
    
    bool push(const Message& msg);
    bool pop(Message& msg, std::chrono::milliseconds timeout = std::chrono::milliseconds(1000));
    
    size_t size() const;
    bool empty() const;
    
private:
    std::queue<Message> queue_;
    mutable std::mutex mutex_;
    std::condition_variable not_empty_cv_;
    size_t max_size_;
};

}  // namespace log_queue
