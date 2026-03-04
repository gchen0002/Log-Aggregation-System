#include <iostream>
#include <csignal>
#include <atomic>
#include <thread>
#include <chrono>
#include <sstream>
#include <vector>
#include <string>
#include <filesystem>
#include <stdexcept>

#include <nlohmann/json.hpp>

#include "../include/sqlite_queue.hpp"
#include "../include/http_server.hpp"

namespace {
    volatile sig_atomic_t g_shutdown_requested = 0;
    constexpr auto kCleanupInterval = std::chrono::hours(1);
    constexpr size_t MAX_JSON_BATCH_SIZE = 1000;  // Maximum items in JSON array
    
    // Validate database path to prevent path traversal
    bool isPathSafe(const std::string& path) {
        try {
            std::filesystem::path p = std::filesystem::absolute(path);
            std::filesystem::path cwd = std::filesystem::current_path();
            
            // Check if path is within current working directory or a subdirectory
            std::string p_str = p.string();
            std::string cwd_str = cwd.string();
            
            // Path must start with cwd
            if (p_str.find(cwd_str) != 0) {
                return false;
            }
            
            // Check for ".." in the path
            for (const auto& part : p) {
                if (part == "..") {
                    return false;
                }
            }
            
            return true;
        } catch (...) {
            return false;
        }
    }
    
    void signalHandler(int) {
        g_shutdown_requested = 1;
    }
}

int main(int argc, char* argv[]) {
    try {
        // Default config
        int port = 8080;
        std::string dbPath = "./data/queue.db";
        
        // Parse simple args with validation
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--port") {
                if (i + 1 >= argc) {
                    std::cerr << "Error: --port requires a value" << std::endl;
                    return 1;
                }
                try {
                    port = std::stoi(argv[++i]);
                    if (port < 1 || port > 65535) {
                        std::cerr << "Error: Port must be between 1 and 65535" << std::endl;
                        return 1;
                    }
                } catch (const std::exception&) {
                    std::cerr << "Error: Invalid port number" << std::endl;
                    return 1;
                }
            } else if (arg == "--db") {
                if (i + 1 >= argc) {
                    std::cerr << "Error: --db requires a value" << std::endl;
                    return 1;
                }
                dbPath = argv[++i];
                
                // Validate path to prevent path traversal
                if (!isPathSafe(dbPath)) {
                    std::cerr << "Error: Database path must be within current directory and not contain '..'" << std::endl;
                    return 1;
                }
            } else if (arg == "--help") {
                std::cout << "Usage: " << argv[0] << " [options]\n"
                          << "Options:\n"
                          << "  --port <n>    Port to listen on (default: 8080)\n"
                          << "  --db <path>   Database file path (default: ./data/queue.db)\n"
                          << "  --help        Show this message\n";
                return 0;
            } else {
                std::cerr << "Unknown option: " << arg << std::endl;
                return 1;
            }
        }
        
        std::cout << "Log Queue Starting..." << std::endl;
        std::cout << "  Port: " << port << std::endl;
        std::cout << "  Database: " << dbPath << std::endl;
        
        // Set up signal handlers
        if (std::signal(SIGINT, signalHandler) == SIG_ERR) {
            std::cerr << "Failed to install SIGINT handler" << std::endl;
            return 1;
        }
        if (std::signal(SIGTERM, signalHandler) == SIG_ERR) {
            std::cerr << "Failed to install SIGTERM handler" << std::endl;
            return 1;
        }
        
        // Create queue
        log_queue::SqliteQueue queue(dbPath);
        
        // Create HTTP server with handlers
        log_queue::HttpServer server(port, 
            [&queue](const std::string& method, const std::string& path, const std::string& body) 
            -> std::string {
                // POST /api/logs/batch - Enqueue
                if (method == "POST" && path == "/api/logs/batch") {
                    try {
                        // Parse JSON array using nlohmann/json
                        auto j = nlohmann::json::parse(body);
                        
                        // Validate array size to prevent DoS
                        if (!j.is_array()) {
                            return "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: 18\r\n\r\nExpected JSON array";
                        }
                        
                        if (j.size() > MAX_JSON_BATCH_SIZE) {
                            return "HTTP/1.1 413 Payload Too Large\r\nContent-Type: text/plain\r\nContent-Length: 20\r\n\r\nBatch size too large";
                        }
                        
                        std::vector<std::string> batch;
                        batch.reserve(j.size());  // Pre-allocate to avoid reallocations
                        
                        for (const auto& item : j) {
                            if (item.is_string()) {
                                batch.push_back(item.get<std::string>());
                            }
                        }
                        
                        if (queue.enqueue(batch)) {
                            return "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nOK";
                        } else {
                            return "HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nError";
                        }
                    } catch (const nlohmann::json::exception& e) {
                        return "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: 12\r\n\r\nInvalid JSON";
                    }
                }
                
                // GET /api/logs/pending - Dequeue
                if (method == "GET" && path == "/api/logs/pending") {
                    auto result = queue.dequeue(100);
                    if (result && !result->empty()) {
                        // Build JSON response using nlohmann/json (safe escaping)
                        nlohmann::json response_json = *result;
                        std::string response_body = response_json.dump();
                        
                        std::ostringstream response;
                        response << "HTTP/1.1 200 OK\r\n"
                                 << "Content-Type: application/json\r\n"
                                 << "Content-Length: " << response_body.length() << "\r\n"
                                 << "\r\n" << response_body;
                        return response.str();
                    } else {
                        return "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n[]";
                    }
                }
                
                // GET /api/queue/stats - Queue metrics
                if (method == "GET" && path == "/api/queue/stats") {
                    size_t pending = queue.getPendingCount();
                    size_t total = queue.getTotalCount();
                    
                    nlohmann::json stats;
                    stats["pending"] = pending;
                    stats["total"] = total;
                    std::string bodyStr = stats.dump();
                    
                    std::ostringstream response;
                    response << "HTTP/1.1 200 OK\r\n"
                             << "Content-Type: application/json\r\n"
                             << "Content-Length: " << bodyStr.length() << "\r\n"
                             << "\r\n" << bodyStr;
                    return response.str();
                }
                
                // 404 Not Found
                return "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\n\r\nNot Found";
            }
        );
        
        // Start server
        server.start();
        
        std::cout << "Queue is running. Press Ctrl+C to stop." << std::endl;
        
        // Cleanup thread
        std::atomic<bool> cleanup_running{true};
        std::thread cleanup_thread([&queue, &cleanup_running]() {
            while (cleanup_running.load()) {
                std::this_thread::sleep_for(kCleanupInterval);
                queue.cleanupProcessed(24);  // Clean up messages older than 24 hours
            }
        });
        
        // Main loop
        while (!g_shutdown_requested) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        
        // Shutdown
        std::cout << "\nShutting down..." << std::endl;
        cleanup_running.store(false);
        server.stop();
        cleanup_thread.join();
        
        std::cout << "Queue stopped." << std::endl;
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }
}
