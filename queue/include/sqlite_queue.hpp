#pragma once

#include <string>
#include <vector>
#include <optional>
#include <memory>
#include <mutex>

struct sqlite3;

namespace log_queue {

class SqliteQueue {
public:
    explicit SqliteQueue(const std::string& dbPath);
    ~SqliteQueue();
    
    // Producer: Add batch of messages
    bool enqueue(const std::vector<std::string>& batch);
    
    // Consumer: Get batch of messages (marks as processed)
    std::optional<std::vector<std::string>> dequeue(size_t maxMessages = 100);
    
    // Stats
    size_t getPendingCount();
    size_t getTotalCount();
    
    // Cleanup processed messages older than N hours
    void cleanupProcessed(size_t olderThanHours = 24);
    
private:
    bool initializeDatabase();
    
    sqlite3* db_;
    std::string db_path_;
    std::mutex mutex_;  // Protects DB operations
};

}  // namespace log_queue
