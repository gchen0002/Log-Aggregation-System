#pragma once
#include "../../native/include/common.hpp"
#include <mutex>
#include <sqlite3.h>
namespace log_queue {
class SqliteQueue {
    sqlite3 *db_ = nullptr;
    std::mutex mutex_;
    unsigned capacity_, lease_;
    void exec(const char *sql);

  public:
    SqliteQueue(const std::string &path, unsigned capacity, unsigned lease);
    ~SqliteQueue();
    int enqueue(const std::string &id, const pipeline::json &logs);
    std::string claim(unsigned limit);
    unsigned acknowledge(const pipeline::json &receipts);
    pipeline::json stats();
};
} // namespace log_queue
