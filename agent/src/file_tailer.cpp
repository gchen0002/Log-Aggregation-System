#include "file_tailer.hpp"
#include <fstream>
#include <thread>
#include <chrono>
#include <iostream>

namespace log_agent {

FileTailer::FileTailer(const std::string& filepath, Callback callback)
    : filepath_(filepath), callback_(std::move(callback)) {
}

FileTailer::~FileTailer() {
    stop();
}

void FileTailer::start() {
    bool expected = false;
    if (!running_.compare_exchange_strong(expected, true, 
                                          std::memory_order_acq_rel,
                                          std::memory_order_relaxed)) {
        std::cerr << "FileTailer already running: " << filepath_ << std::endl;
        return;
    }

    try {
        thread_ = std::thread(&FileTailer::run, this);
    } catch (...) {
        running_.store(false, std::memory_order_release);
        throw;
    }
}

void FileTailer::stop() {
    running_.store(false, std::memory_order_release);
    
    if (thread_.joinable()) {
        thread_.join();
    }
}

void FileTailer::run() {
    std::ifstream file;
    std::streamoff last_position = 0;
    std::string incomplete_line;
    
    auto open_or_reopen_file = [&file, this, &last_position]() -> bool {
        if (file.is_open()) {
            file.close();
        }
        
        file.open(filepath_, std::ios::binary);
        if (!file.is_open()) {
            return false;
        }
        
        file.seekg(last_position, std::ios::beg);
        return file.good();
    };
    
    while (running_.load(std::memory_order_acquire)) {
        if (!file.is_open()) {
            if (!open_or_reopen_file()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                continue;
            }
        }
        
        file.seekg(0, std::ios::end);
        std::streamoff current_size = file.tellg();
        
        if (current_size < last_position) {
            // File was rotated/truncated
            last_position = 0;
            if (!open_or_reopen_file()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                continue;
            }
        }
        
        if (current_size > last_position) {
            // New data available
            std::streamoff bytes_to_read = current_size - last_position;
            if (bytes_to_read <= 0) {
                continue;
            }
            
            file.seekg(last_position, std::ios::beg);
            
            std::string buffer;
            buffer.resize(static_cast<size_t>(bytes_to_read));
            file.read(buffer.data(), bytes_to_read);
            
            if (!file.good() && !file.eof()) {
                // Read error, reopen on next iteration
                file.close();
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                continue;
            }
            
            // Only update position after successful read
            last_position = current_size;
            
            // Process buffer line by line
            std::string_view view(buffer);
            size_t start = 0;
            size_t end = 0;
            
            while (end < view.size()) {
                if (view[end] == '\n') {
                    // Found a complete line
                    std::string line;
                    if (!incomplete_line.empty()) {
                        line = incomplete_line;
                        line.append(view.substr(start, end - start));
                        incomplete_line.clear();
                    } else {
                        line = view.substr(start, end - start);
                    }
                    
                    // Strip \r if present (Windows line endings)
                    if (!line.empty() && line.back() == '\r') {
                        line.pop_back();
                    }
                    
                    try {
                        callback_(line);
                    } catch (...) {
                        // Log but don't stop processing
                        std::cerr << "FileTailer callback exception for: " << filepath_ << std::endl;
                    }
                    
                    start = end + 1;
                }
                ++end;
            }
            
            // Save incomplete line for next iteration
            if (start < view.size()) {
                if (incomplete_line.empty()) {
                    incomplete_line = view.substr(start);
                } else {
                    incomplete_line.append(view.substr(start));
                }
            }
        }
        
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    
    // Flush remaining incomplete line on shutdown
    if (!incomplete_line.empty() && callback_) {
        try {
            callback_(incomplete_line);
        } catch (...) {
            std::cerr << "FileTailer final callback exception for: " << filepath_ << std::endl;
        }
    }
}

}  // namespace log_agent
