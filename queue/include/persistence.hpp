#pragma once

#include <string>
#include <fstream>
#include <vector>
#include <mutex>

namespace log_queue {

class Persistence {
public:
    explicit Persistence(const std::string& dataPath);
    ~Persistence();
    
    bool save(const std::string& id, const std::string& content);
    bool remove(const std::string& id);
    std::vector<std::pair<std::string, std::string>> loadAll();
    
private:
    std::string data_path_;
    std::ofstream write_stream_;
    std::mutex mutex_;
};

}  // namespace log_queue
