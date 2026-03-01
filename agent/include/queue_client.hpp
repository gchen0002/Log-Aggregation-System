#pragma once

#include <string>
#include <vector>

namespace log_agent {

class QueueClient {
public:
    explicit QueueClient(const std::string& queueHost, int queuePort);
    ~QueueClient() = default;
    
    bool send(const std::vector<std::string>& batch);
    
private:
    std::string queue_host_;
    int queue_port_;
};

}  // namespace log_agent
