#include "queue_client.hpp"
#include <nlohmann/json.hpp>
#include <iostream>
#include <chrono>
#include <thread>
#include <sstream>
#include <cstring>
#include <mutex>

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <netdb.h>
    #include <fcntl.h>
    #include <errno.h>
#endif

namespace log_agent {

namespace {
    constexpr int MAX_RETRIES = 3;
    constexpr std::chrono::milliseconds TIMEOUT(5000);
    constexpr size_t RECV_BUFFER_SIZE = 4096;
    
    #ifdef _WIN32
        using socket_ssize_t = int;
        static std::once_flag wsa_init_flag;
        static bool wsa_initialized = false;
        
        void initWinsock() {
            WSADATA wsaData;
            wsa_initialized = (WSAStartup(MAKEWORD(2, 2), &wsaData) == 0);
            if (!wsa_initialized) {
                std::cerr << "QueueClient: WSAStartup failed" << std::endl;
            }
        }
    #else
        using socket_ssize_t = ssize_t;
    #endif
    
    class SocketGuard {
        int sockfd_;
    public:
        explicit SocketGuard(int sockfd) : sockfd_(sockfd) {}
        ~SocketGuard() { 
            if (sockfd_ >= 0) {
                #ifdef _WIN32
                    closesocket(sockfd_);
                #else
                    close(sockfd_);
                #endif
            }
        }
        void release() { sockfd_ = -1; }
        int get() const { return sockfd_; }
    };
    
    bool setSocketTimeout(int sockfd, std::chrono::milliseconds timeout) {
        #ifdef _WIN32
            DWORD ms = static_cast<DWORD>(timeout.count());
            if (setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, 
                          reinterpret_cast<const char*>(&ms), sizeof(ms)) != 0) {
                return false;
            }
            if (setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO,
                          reinterpret_cast<const char*>(&ms), sizeof(ms)) != 0) {
                return false;
            }
        #else
            struct timeval tv;
            tv.tv_sec = timeout.count() / 1000;
            tv.tv_usec = (timeout.count() % 1000) * 1000;
            if (setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) != 0) {
                return false;
            }
            if (setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv)) != 0) {
                return false;
            }
        #endif
        return true;
    }
    
    void closeSocket(int sockfd) {
        #ifdef _WIN32
            closesocket(sockfd);
        #else
            close(sockfd);
        #endif
    }
}

QueueClient::QueueClient(const std::string& queueHost, int queuePort)
    : queue_host_(queueHost), queue_port_(queuePort) {
    #ifdef _WIN32
        std::call_once(wsa_init_flag, initWinsock);
    #endif
}

bool QueueClient::send(const std::vector<std::string>& batch) {
    if (batch.empty()) {
        return true;
    }
    
    // Build JSON body
    nlohmann::json json_body = nlohmann::json::array();
    for (const auto& log : batch) {
        json_body.push_back(log);
    }
    std::string body = json_body.dump();
    
    // Retry loop
    for (int attempt = 0; attempt < MAX_RETRIES; ++attempt) {
        if (attempt > 0) {
            auto sleep_ms = std::chrono::milliseconds(100 * (1 << attempt));
            std::this_thread::sleep_for(sleep_ms);
        }
        
        // Create socket
        int sockfd = socket(AF_INET, SOCK_STREAM, 0);
        if (sockfd < 0) {
            std::cerr << "QueueClient: Failed to create socket" << std::endl;
            continue;
        }
        
        SocketGuard guard(sockfd);
        
        // Set timeouts
        if (!setSocketTimeout(sockfd, TIMEOUT)) {
            std::cerr << "QueueClient: Failed to set socket timeout" << std::endl;
            continue;
        }
        
        // Resolve hostname using getaddrinfo (thread-safe, IPv6 support)
        struct addrinfo hints = {};
        hints.ai_family = AF_INET;  // IPv4 for now
        hints.ai_socktype = SOCK_STREAM;
        
        struct addrinfo* result = nullptr;
        std::string port_str = std::to_string(queue_port_);
        int status = getaddrinfo(queue_host_.c_str(), port_str.c_str(), &hints, &result);
        if (status != 0) {
            std::cerr << "QueueClient: Failed to resolve hostname: " << queue_host_ << std::endl;
            continue;
        }
        
        // Connect to server
        bool connected = false;
        for (struct addrinfo* rp = result; rp != nullptr; rp = rp->ai_next) {
            if (connect(sockfd, rp->ai_addr, static_cast<int>(rp->ai_addrlen)) == 0) {
                connected = true;
                break;
            }
        }
        freeaddrinfo(result);
        
        if (!connected) {
            std::cerr << "QueueClient: Failed to connect to " << queue_host_ 
                      << ":" << queue_port_ << std::endl;
            continue;
        }
        
        // Build HTTP request
        std::ostringstream request;
        request << "POST /api/logs/batch HTTP/1.1\r\n"
                << "Host: " << queue_host_ << "\r\n"
                << "Content-Type: application/json\r\n"
                << "Content-Length: " << body.length() << "\r\n"
                << "Connection: close\r\n"
                << "\r\n"
                << body;
        
        std::string request_str = request.str();
        
        // Send request
        bool send_success = true;
        size_t total_sent = 0;
        while (total_sent < request_str.length()) {
            size_t remaining = request_str.length() - total_sent;
            #ifdef _WIN32
                socket_ssize_t sent = ::send(sockfd, request_str.c_str() + total_sent,
                                     static_cast<int>(remaining), 0);
            #else
                socket_ssize_t sent = ::send(sockfd, request_str.c_str() + total_sent,
                                     remaining, 0);
            #endif
            if (sent < 0) {
                std::cerr << "QueueClient: Send failed" << std::endl;
                send_success = false;
                break;
            }
            total_sent += static_cast<size_t>(sent);
        }
        
        if (!send_success) {
            continue;
        }
        
        // Receive response
        char buffer[RECV_BUFFER_SIZE];
        std::string response;
        socket_ssize_t received;
        
        while ((received = recv(sockfd, buffer, RECV_BUFFER_SIZE - 1, 0)) > 0) {
            response.append(buffer, static_cast<size_t>(received));
        }
        
        if (received < 0) {
            #ifdef _WIN32
                int err = WSAGetLastError();
                if (err != WSAETIMEDOUT && err != WSAEWOULDBLOCK) {
                    std::cerr << "QueueClient: Receive error: " << err << std::endl;
                }
            #else
                if (errno != EAGAIN && errno != EWOULDBLOCK) {
                    std::cerr << "QueueClient: Receive error: " << strerror(errno) << std::endl;
                }
            #endif
        }
        
        guard.release();  // Success, don't close on exit
        
        // Parse HTTP response
        if (response.empty()) {
            std::cerr << "QueueClient: Empty response" << std::endl;
            continue;
        }
        
        // Check for HTTP 200 OK (parse status line properly)
        size_t space_pos = response.find(' ');
        if (space_pos != std::string::npos && space_pos + 3 <= response.length()) {
            try {
                int status_code = std::stoi(response.substr(space_pos + 1, 3));
                if (status_code == 200) {
                    return true;
                }
            } catch (...) {
                // Invalid status code
            }
        }
        
        std::cerr << "QueueClient: Non-200 response" << std::endl;
    }
    
    return false;
}

}  // namespace log_agent
