#pragma once

#include <string>
#include <functional>
#include <thread>
#include <atomic>

namespace log_queue {

class HttpServer {
public:
    using MessageCallback = std::function<std::string(const std::string& method, 
                                                       const std::string& path, 
                                                       const std::string& body)>;
    
    explicit HttpServer(int port, MessageCallback callback);
    ~HttpServer();
    
    void start();
    void stop();
    
private:
    void run();
    void handleClient(int clientSocket);
    
    int port_;
    MessageCallback callback_;
    int server_socket_;
    std::thread server_thread_;
    std::atomic<bool> running_{false};
};

}  // namespace log_queue
