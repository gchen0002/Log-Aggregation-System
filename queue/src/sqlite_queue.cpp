#include "../include/sqlite_queue.hpp"
#include <sqlite3.h>
#include <iostream>
#include <sstream>
#include <chrono>
#include <vector>
#include <optional>
#include <limits>

namespace log_queue {

namespace {
    constexpr size_t MAX_BATCH_SIZE = 1000;
    constexpr size_t MAX_CLEANUP_HOURS = 720;  // 30 days max
    
    // RAII transaction guard
    class TransactionGuard {
        sqlite3* db_;
        bool committed_ = false;
    public:
        explicit TransactionGuard(sqlite3* db) : db_(db) {
            sqlite3_exec(db_, "BEGIN;", nullptr, nullptr, nullptr);
        }
        void commit() { committed_ = true; }
        ~TransactionGuard() {
            if (!committed_) {
                sqlite3_exec(db_, "ROLLBACK;", nullptr, nullptr, nullptr);
            }
        }
    };
    
    // RAII statement guard
    class StmtGuard {
        sqlite3_stmt* stmt_;
    public:
        explicit StmtGuard(sqlite3_stmt* stmt) : stmt_(stmt) {}
        ~StmtGuard() { 
            if (stmt_) sqlite3_finalize(stmt_); 
        }
        void release() { stmt_ = nullptr; }
    };
}

SqliteQueue::SqliteQueue(const std::string& dbPath)
    : db_(nullptr), db_path_(dbPath) {
    int rc = sqlite3_open(dbPath.c_str(), &db_);
    if (rc != SQLITE_OK) {
        std::string error = "Failed to open database: ";
        error += sqlite3_errmsg(db_);
        sqlite3_close(db_);  // Clean up even on error
        throw std::runtime_error(error);
    }
    
    // Set busy timeout for concurrent access
    sqlite3_busy_timeout(db_, 5000);  // 5 second timeout
    
    if (!initializeDatabase()) {
        sqlite3_close(db_);
        throw std::runtime_error("Failed to initialize database schema");
    }
}

SqliteQueue::~SqliteQueue() {
    if (db_) {
        sqlite3_close(db_);
    }
}

bool SqliteQueue::initializeDatabase() {
    const char* createTableSQL = R"(
        CREATE TABLE IF NOT EXISTS message_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed BOOLEAN DEFAULT 0,
            processed_at TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_unprocessed 
        ON message_queue(processed, created_at) 
        WHERE processed = 0;
    )";
    
    char* errMsg = nullptr;
    int rc = sqlite3_exec(db_, createTableSQL, nullptr, nullptr, &errMsg);
    if (rc != SQLITE_OK) {
        std::cerr << "SQL error: " << errMsg << std::endl;
        sqlite3_free(errMsg);
        return false;
    }
    
    // Enable WAL mode for better concurrency
    rc = sqlite3_exec(db_, "PRAGMA journal_mode=WAL;", nullptr, nullptr, &errMsg);
    if (rc != SQLITE_OK) {
        sqlite3_free(errMsg);
        // Not fatal, continue without WAL
    }
    
    // Configure WAL autocheckpoint
    sqlite3_exec(db_, "PRAGMA wal_autocheckpoint=1000;", nullptr, nullptr, nullptr);
    
    return true;
}

bool SqliteQueue::enqueue(const std::vector<std::string>& batch) {
    if (!db_ || batch.empty()) {
        return false;
    }
    
    if (batch.size() > MAX_BATCH_SIZE) {
        std::cerr << "Batch size exceeds maximum of " << MAX_BATCH_SIZE << std::endl;
        return false;
    }
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // Join batch into JSON array
    std::ostringstream json;
    json << "[";
    for (size_t i = 0; i < batch.size(); ++i) {
        if (i > 0) json << ",";
        // Escape quotes in the data
        json << "\"";
        for (char c : batch[i]) {
            if (c == '"' || c == '\\') json << '\\';
            json << c;
        }
        json << "\"";
    }
    json << "]";
    
    std::string data = json.str();
    
    sqlite3_stmt* stmt;
    const char* sql = "INSERT INTO message_queue (data) VALUES (?);";
    
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        std::cerr << "Failed to prepare statement: " << sqlite3_errmsg(db_) << std::endl;
        return false;
    }
    
    StmtGuard guard(stmt);
    
    sqlite3_bind_text(stmt, 1, data.c_str(), -1, SQLITE_TRANSIENT);
    
    rc = sqlite3_step(stmt);
    
    if (rc != SQLITE_DONE) {
        std::cerr << "Failed to insert: " << sqlite3_errmsg(db_) << std::endl;
        return false;
    }
    
    return true;
}

std::optional<std::vector<std::string>> SqliteQueue::dequeue(size_t maxMessages) {
    if (!db_) {
        return std::nullopt;
    }
    
    // Validate bounds - prevent integer overflow
    if (maxMessages == 0 || maxMessages > MAX_BATCH_SIZE || 
        maxMessages > static_cast<size_t>(std::numeric_limits<int64_t>::max())) {
        maxMessages = 100;  // Default fallback
    }
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // RAII transaction guard
    TransactionGuard tx(db_);
    
    // Select unprocessed messages using parameterized LIMIT
    const char* sql = "SELECT id, data FROM message_queue WHERE processed = 0 "
                      "ORDER BY created_at LIMIT ?;";
    
    sqlite3_stmt* stmt;
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        return std::nullopt;
    }
    
    StmtGuard stmtGuard(stmt);
    
    sqlite3_bind_int64(stmt, 1, static_cast<int64_t>(maxMessages));
    
    std::vector<std::string> result;
    std::vector<int64_t> ids;
    
    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        int64_t id = sqlite3_column_int64(stmt, 0);
        const char* data = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));
        
        ids.push_back(id);
        result.push_back(data ? data : "");
    }
    
    if (result.empty()) {
        return std::nullopt;
    }
    
    // Mark as processed using parameterized query
    std::ostringstream updateSql;
    updateSql << "UPDATE message_queue SET processed = 1, processed_at = CURRENT_TIMESTAMP "
              << "WHERE id IN (";
    for (size_t i = 0; i < ids.size(); ++i) {
        if (i > 0) updateSql << ",";
        updateSql << "?";
    }
    updateSql << ");";
    
    sqlite3_stmt* updateStmt;
    rc = sqlite3_prepare_v2(db_, updateSql.str().c_str(), -1, &updateStmt, nullptr);
    if (rc != SQLITE_OK) {
        return std::nullopt;
    }
    
    StmtGuard updateGuard(updateStmt);
    
    // Bind all IDs
    for (size_t i = 0; i < ids.size(); ++i) {
        sqlite3_bind_int64(updateStmt, static_cast<int>(i + 1), ids[i]);
    }
    
    rc = sqlite3_step(updateStmt);
    
    if (rc != SQLITE_DONE) {
        std::cerr << "Failed to mark processed: " << sqlite3_errmsg(db_) << std::endl;
        return std::nullopt;
    }
    
    tx.commit();  // Mark transaction as successful
    return result;
}

size_t SqliteQueue::getPendingCount() {
    if (!db_) {
        return 0;
    }
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    sqlite3_stmt* stmt;
    const char* sql = "SELECT COUNT(*) FROM message_queue WHERE processed = 0;";
    
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        return 0;
    }
    
    StmtGuard guard(stmt);
    
    size_t count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = static_cast<size_t>(sqlite3_column_int64(stmt, 0));
    }
    
    return count;
}

size_t SqliteQueue::getTotalCount() {
    if (!db_) {
        return 0;
    }
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    sqlite3_stmt* stmt;
    const char* sql = "SELECT COUNT(*) FROM message_queue;";
    
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        return 0;
    }
    
    StmtGuard guard(stmt);
    
    size_t count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = static_cast<size_t>(sqlite3_column_int64(stmt, 0));
    }
    
    return count;
}

void SqliteQueue::cleanupProcessed(size_t olderThanHours) {
    if (!db_) {
        return;
    }
    
    // Validate input
    if (olderThanHours > MAX_CLEANUP_HOURS) {
        olderThanHours = 24;  // Default to 24 hours
    }
    
    std::lock_guard<std::mutex> lock(mutex_);
    
    // Use parameterized query for safety
    const char* sql = "DELETE FROM message_queue WHERE processed = 1 "
                      "AND processed_at < datetime('now', ?);";
    
    sqlite3_stmt* stmt;
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        std::cerr << "Failed to prepare cleanup statement" << std::endl;
        return;
    }
    
    StmtGuard guard(stmt);
    
    // Construct the interval string
    std::string interval = "-" + std::to_string(olderThanHours) + " hours";
    sqlite3_bind_text(stmt, 1, interval.c_str(), -1, SQLITE_TRANSIENT);
    
    rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE) {
        std::cerr << "Failed to cleanup: " << sqlite3_errmsg(db_) << std::endl;
    }
}

}  // namespace log_queue
