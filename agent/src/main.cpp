#include <atomic>
#include <chrono>
#include <csignal>
#include <ctime>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "batcher.hpp"
#include "file_tailer.hpp"
#include "log_parser.hpp"
#include "queue_client.hpp"

namespace {
    // Signal-safe flag for shutdown
    volatile sig_atomic_t g_shutdown_requested = 0;
    
    constexpr auto kPollInterval = std::chrono::milliseconds(100);
    
    void signalHandler(int) {
        g_shutdown_requested = 1;
    }
    
    void printUsage(const char* programName) {
        std::cout << "Usage: " << programName << " [options]\n"
                  << "Options:\n"
                  << "  --file <path>         Log file to tail (required)\n"
                  << "  --queue-host <host>   Queue server host (default: localhost)\n"
                  << "  --queue-port <port>   Queue server port (default: 8080)\n"
                  << "  --batch-size <n>      Batch size (default: 100)\n"
                  << "  --flush-interval <ms> Flush interval in ms (default: 1000)\n"
                  << "  -h, --help           Show this help message\n";
    }
    
    struct Config {
        std::string log_file;
        std::string queue_host = "localhost";
        int queue_port = 8080;
        size_t batch_size = 100;
        std::chrono::milliseconds flush_interval{1000};
    };
    
    Config parseArgs(int argc, char* argv[]) {
        Config config;
        
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            
            if (arg == "-h" || arg == "--help") {
                printUsage(argv[0]);
                exit(0);
            } else if (arg == "--file") {
                if (i + 1 >= argc || argv[i + 1][0] == '-') {
                    std::cerr << "Error: --file requires a value" << std::endl;
                    exit(1);
                }
                config.log_file = argv[++i];
            } else if (arg == "--queue-host") {
                if (i + 1 >= argc || argv[i + 1][0] == '-') {
                    std::cerr << "Error: --queue-host requires a value" << std::endl;
                    exit(1);
                }
                config.queue_host = argv[++i];
            } else if (arg == "--queue-port") {
                if (i + 1 >= argc || argv[i + 1][0] == '-') {
                    std::cerr << "Error: --queue-port requires a value" << std::endl;
                    exit(1);
                }
                try {
                    config.queue_port = std::stoi(argv[++i]);
                    if (config.queue_port < 1 || config.queue_port > 65535) {
                        std::cerr << "Error: Port must be between 1 and 65535" << std::endl;
                        exit(1);
                    }
                } catch (const std::exception&) {
                    std::cerr << "Error: Invalid port number: " << argv[i] << std::endl;
                    exit(1);
                }
            } else if (arg == "--batch-size") {
                if (i + 1 >= argc || argv[i + 1][0] == '-') {
                    std::cerr << "Error: --batch-size requires a value" << std::endl;
                    exit(1);
                }
                try {
                    config.batch_size = std::stoul(argv[++i]);
                } catch (const std::exception&) {
                    std::cerr << "Error: Invalid batch size: " << argv[i] << std::endl;
                    exit(1);
                }
            } else if (arg == "--flush-interval") {
                if (i + 1 >= argc || argv[i + 1][0] == '-') {
                    std::cerr << "Error: --flush-interval requires a value" << std::endl;
                    exit(1);
                }
                try {
                    config.flush_interval = std::chrono::milliseconds(std::stoul(argv[++i]));
                } catch (const std::exception&) {
                    std::cerr << "Error: Invalid flush interval: " << argv[i] << std::endl;
                    exit(1);
                }
            } else {
                std::cerr << "Unknown option: " << arg << std::endl;
                printUsage(argv[0]);
                exit(1);
            }
        }
        
        return config;
    }
    
    // Thread-safe time formatting
    std::string formatTimestamp(std::chrono::system_clock::time_point tp) {
        auto time_t = std::chrono::system_clock::to_time_t(tp);
        char time_str[100];
        
        #ifdef _WIN32
            std::tm time_info;
            localtime_s(&time_info, &time_t);
            std::strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%S", &time_info);
        #else
            std::tm time_info;
            localtime_r(&time_t, &time_info);
            std::strftime(time_str, sizeof(time_str), "%Y-%m-%dT%H:%M:%S", &time_info);
        #endif
        
        return std::string(time_str);
    }
}

int main(int argc, char* argv[]) {
    try {
        // Parse command line arguments
        Config config = parseArgs(argc, argv);
        
        if (config.log_file.empty()) {
            std::cerr << "Error: --file is required" << std::endl;
            printUsage(argv[0]);
            return 1;
        }
        
        std::cout << "Log Agent Starting..." << std::endl;
        std::cout << "  Log file: " << config.log_file << std::endl;
        std::cout << "  Queue: " << config.queue_host << ":" << config.queue_port << std::endl;
        std::cout << "  Batch size: " << config.batch_size << std::endl;
        std::cout << "  Flush interval: " << config.flush_interval.count() << "ms" << std::endl;
        
        // Set up signal handlers
        if (std::signal(SIGINT, signalHandler) == SIG_ERR) {
            std::cerr << "Failed to install SIGINT handler" << std::endl;
            return 1;
        }
        if (std::signal(SIGTERM, signalHandler) == SIG_ERR) {
            std::cerr << "Failed to install SIGTERM handler" << std::endl;
            return 1;
        }
        
        // Create queue client
        log_agent::QueueClient queue_client(config.queue_host, config.queue_port);
        
        // Create batcher with callback to send to queue
        // Note: Lambda captures by reference are safe because Batcher doesn't store
        // the callback for async execution - it only calls it synchronously from its
        // own internal thread or from flush()
        std::unique_ptr<log_agent::Batcher> batcher = std::make_unique<log_agent::Batcher>(
            config.batch_size,
            config.flush_interval,
            [&queue_client](const std::vector<std::string>& batch) {
                if (!batch.empty()) {
                    std::cout << "Sending batch of " << batch.size() << " logs" << std::endl;
                    if (!queue_client.send(batch)) {
                        std::cerr << "Failed to send batch to queue" << std::endl;
                    }
                }
            }
        );
        
        // Create log parser
        log_agent::LogParser parser;
        
        // Create file tailer
        // Note: Lambda captures by reference are safe because FileTailer only calls
        // the callback synchronously from its internal thread
        std::unique_ptr<log_agent::FileTailer> tailer = std::make_unique<log_agent::FileTailer>(
            config.log_file,
            [&parser, &batcher, &config](const std::string& line) {
                try {
                    // Parse the log line
                    auto entry = parser.parse(line);
                    if (entry) {
                        // Convert to JSON and add to batcher
                        nlohmann::json json_entry;
                        json_entry["message"] = entry->message;
                        json_entry["level"] = entry->level;
                        json_entry["source"] = entry->source;
                        json_entry["timestamp"] = formatTimestamp(entry->timestamp);
                        
                        if (entry->raw) {
                            json_entry["raw"] = *entry->raw;
                        }
                        
                        batcher->add(json_entry.dump());
                    } else {
                        // If parsing failed, send raw line
                        nlohmann::json json_entry;
                        json_entry["message"] = line;
                        json_entry["level"] = "unknown";
                        json_entry["source"] = config.log_file;
                        json_entry["timestamp"] = formatTimestamp(std::chrono::system_clock::now());
                        
                        batcher->add(json_entry.dump());
                    }
                } catch (const std::exception& e) {
                    std::cerr << "Error processing log line: " << e.what() << std::endl;
                }
            }
        );
        
        // Start the tailer
        tailer->start();
        
        std::cout << "Agent is running. Press Ctrl+C to stop." << std::endl;
        
        // Main loop - wait for shutdown signal
        while (!g_shutdown_requested) {
            std::this_thread::sleep_for(kPollInterval);
        }
        
        // Shutdown gracefully
        std::cout << "\nShutting down..." << std::endl;
        
        // Stop the tailer (this will flush incomplete line)
        tailer->stop();
        tailer.reset();
        
        // Flush any remaining batch
        if (batcher) {
            batcher->flush();
            batcher.reset();
        }
        
        std::cout << "Agent stopped." << std::endl;
        return 0;
        
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }
}
