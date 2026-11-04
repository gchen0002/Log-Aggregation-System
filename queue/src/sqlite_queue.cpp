#include "../include/sqlite_queue.hpp"
#include <chrono>
#include <random>
using pipeline::json;
namespace {
int64_t now() {
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}
struct Statement {
    sqlite3_stmt *p = nullptr;
    Statement(sqlite3 *db, const char *sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &p, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
    }
    ~Statement() { sqlite3_finalize(p); }
    void text(int i, const std::string &s) {
        if (sqlite3_bind_text(p, i, s.data(), static_cast<int>(s.size()), SQLITE_TRANSIENT) !=
            SQLITE_OK)
            throw std::runtime_error("SQLite bind failed");
    }
    void integer(int i, int64_t n) { sqlite3_bind_int64(p, i, n); }
    int step() {
        auto rc = sqlite3_step(p);
        if (rc != SQLITE_ROW && rc != SQLITE_DONE)
            throw std::runtime_error(sqlite3_errmsg(sqlite3_db_handle(p)));
        return rc;
    }
    std::string string(int i) {
        const auto *s = sqlite3_column_text(p, i);
        return s ? reinterpret_cast<const char *>(s) : "";
    }
};
struct Transaction {
    sqlite3 *db;
    bool done = false;
    explicit Transaction(sqlite3 *d) : db(d) {
        if (sqlite3_exec(db, "BEGIN IMMEDIATE", nullptr, nullptr, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
    }
    void commit() {
        if (sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
        done = true;
    }
    ~Transaction() {
        if (!done)
            sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr);
    }
};
} // namespace
namespace log_queue {
void SqliteQueue::exec(const char *sql) {
    if (sqlite3_exec(db_, sql, nullptr, nullptr, nullptr) != SQLITE_OK)
        throw std::runtime_error(sqlite3_errmsg(db_));
}
SqliteQueue::SqliteQueue(const std::string &path, unsigned capacity, unsigned lease)
    : capacity_(capacity), lease_(lease) {
    auto parent = std::filesystem::path(path).parent_path();
    if (!parent.empty())
        std::filesystem::create_directories(parent);
    if (sqlite3_open(path.c_str(), &db_) != SQLITE_OK) {
        if (db_)
            sqlite3_close(db_);
        db_ = nullptr;
        throw std::runtime_error("Cannot open queue database");
    }
    try {
        sqlite3_busy_timeout(db_, 10000);
        exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS "
             "batches(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,payload TEXT "
             "NOT NULL,count INTEGER NOT NULL,lease TEXT,expires INTEGER NOT NULL DEFAULT 0); "
             "CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,digest TEXT NOT NULL); "
             "CREATE TABLE IF NOT EXISTS counters(singleton INTEGER PRIMARY KEY "
             "CHECK(singleton=1),accepted INTEGER NOT NULL DEFAULT 0,acknowledged INTEGER NOT NULL "
             "DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO "
             "counters(singleton) VALUES(1); CREATE INDEX IF NOT EXISTS leases ON "
             "batches(expires,seq);");
    } catch (...) {
        sqlite3_close(db_);
        db_ = nullptr;
        throw;
    }
}
SqliteQueue::~SqliteQueue() {
    if (db_)
        sqlite3_close(db_);
}
int SqliteQueue::enqueue(const std::string &id, const json &logs) {
    const auto payload = logs.dump(), digest = pipeline::fingerprint(payload);
    std::lock_guard lock(mutex_);
    Transaction tx(db_);
    {
        Statement s(db_, "SELECT digest FROM receipts WHERE id=?");
        s.text(1, id);
        if (s.step() == SQLITE_ROW) {
            if (s.string(0) != digest)
                return 409;
            tx.commit();
            return 200;
        }
    }
    {
        Statement s(db_, "SELECT pending FROM counters WHERE singleton=1");
        s.step();
        if (sqlite3_column_int64(s.p, 0) + static_cast<int64_t>(logs.size()) > capacity_)
            return 429;
    }
    {
        Statement s(db_, "INSERT INTO receipts(id,digest) VALUES(?,?)");
        s.text(1, id);
        s.text(2, digest);
        s.step();
    }
    {
        Statement s(db_, "INSERT INTO batches(id,payload,count) VALUES(?,?,?)");
        s.text(1, id);
        s.text(2, payload);
        s.integer(3, logs.size());
        s.step();
    }
    {
        Statement s(db_,
                    "UPDATE counters SET accepted=accepted+?,pending=pending+? WHERE singleton=1");
        s.integer(1, logs.size());
        s.integer(2, logs.size());
        s.step();
    }
    tx.commit();
    return 201;
}
std::string SqliteQueue::claim(unsigned limit) {
    std::lock_guard lock(mutex_);
    Transaction tx(db_);
    std::string body = "{\"messages\":[";
    bool comma = false;
    Statement s(db_, "SELECT id,payload FROM batches WHERE expires<=? ORDER BY seq LIMIT ?");
    s.integer(1, now());
    s.integer(2, limit);
    while (s.step() == SQLITE_ROW) {
        auto id = s.string(0), payload = s.string(1);
        auto token = pipeline::fingerprint(
            id + std::to_string(std::random_device{}()) +
            std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        Statement u(db_, "UPDATE batches SET lease=?,expires=? WHERE id=?");
        u.text(1, token);
        u.integer(2, now() + lease_);
        u.text(3, id);
        u.step();
        if (comma)
            body += ",";
        comma = true;
        body += "{\"id\":" + json(id).dump() + ",\"lease\":" + json(token).dump() +
                ",\"logs\":" + payload + "}";
    }
    body += "]}";
    tx.commit();
    return body;
}
unsigned SqliteQueue::acknowledge(const json &receipts) {
    std::lock_guard lock(mutex_);
    Transaction tx(db_);
    unsigned acknowledged = 0;
    for (const auto &receipt : receipts) {
        Statement s(db_, "SELECT count FROM batches WHERE id=? AND lease=? AND expires>?");
        s.text(1, receipt.at("id").get<std::string>());
        s.text(2, receipt.at("lease").get<std::string>());
        s.integer(3, now());
        if (s.step() != SQLITE_ROW)
            continue;
        auto count = sqlite3_column_int64(s.p, 0);
        {
            Statement d(db_, "DELETE FROM batches WHERE id=? AND lease=?");
            d.text(1, receipt.at("id"));
            d.text(2, receipt.at("lease"));
            d.step();
        }
        {
            Statement u(db_, "UPDATE counters SET pending=pending-?,acknowledged=acknowledged+? "
                             "WHERE singleton=1");
            u.integer(1, count);
            u.integer(2, count);
            u.step();
        }
        ++acknowledged;
    }
    tx.commit();
    return acknowledged;
}
json SqliteQueue::stats() {
    std::lock_guard lock(mutex_);
    Statement s(db_, "SELECT accepted,acknowledged,pending FROM counters WHERE singleton=1");
    s.step();
    return {{"total", sqlite3_column_int64(s.p, 0)},
            {"acknowledged", sqlite3_column_int64(s.p, 1)},
            {"pending", sqlite3_column_int64(s.p, 2)},
            {"capacity", capacity_}};
}
} // namespace log_queue
