#include "../include/http_server.hpp"
#include "../include/sqlite_queue.hpp"

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <unistd.h>
    #include <fcntl.h>
    #include <errno.h>
#endif

#include <iostream>
#include <cstring>
#include <sstream>
#include <thread>
#include <algorithm>
#include <cctype>

namespace log_queue {

namespace {
    // Constants for security limits
    constexpr size_t MAX_REQUEST_SIZE = 65536;  // 64KB max request
    constexpr size_t MAX_BODY_SIZE = 32768;     // 32KB max body
    constexpr int SOCKET_TIMEOUT_MS = 30000;    // 30 second timeout
    
    #ifdef _WIN32
        static std::once_flag wsa_init_flag;
        static bool wsa_initialized = false;
        
        void initWinsock() {
            WSADATA wsaData;
            if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
                throw std::runtime_error("Failed to initialize Winsock");
            }
            wsa_initialized = true;
        }
    #endif
    
    void closeSocket(int sockfd) {
        #ifdef _WIN32
            closesocket(sockfd);
        #else
            close(sockfd);
        #endif
    }
    
    bool setSocketTimeout(int sockfd, int timeout_ms) {
        #ifdef _WIN32
            DWORD timeout = timeout_ms;
            return setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, 
                            reinterpret_cast<const char*>(&timeout), sizeof(timeout)) == 0;
        #else
            struct timeval tv;
            tv.tv_sec = timeout_ms / 1000;
            tv.tv_usec = (timeout_ms % 1000) * 1000;
            return setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) == 0;
        #endif
    }
    
    // Extract Content-Length header value
    size_t getContentLength(const std::string& headers) {
        size_t pos = headers.find("Content-Length:");
        if (pos == std::string::npos) {
            pos = headers.find("content-length:");
        }
        if (pos == std::string::npos) {
            return 0;
        }
        
        pos += 15;  // Length of "Content-Length:"
        while (pos < headers.size() && std::isspace(static_cast<unsigned char>(headers[pos]))) {
            pos++;
        }
        
        size_t end = headers.find("\r\n", pos);
        if (end == std::string::npos) {
            return 0;
        }
        
        try {
            return static_cast<size_t>(std::stoul(headers.substr(pos, end - pos)));
        } catch (...) {
            return 0;
        }
    }
}

HttpServer::HttpServer(int port, MessageCallback callback)
    : port_(port), callback_(std::move(callback)), server_socket_(-1) {
    if (port < 1 || port > 65535) {
        throw std::invalid_argument("Invalid port number");
    }
    
    #ifdef _WIN32
        std::call_once(wsa_init_flag, initWinsock);
    #endif
}

HttpServer::~HttpServer() {
    if (running_.load()) {
        stop();
    }
}

void HttpServer::start() {
    bool expected = false;
    if (!running_.compare_exchange_strong(expected, true)) {
        std::cerr << "HTTP server already running" << std::endl;
        return;
    }
    
    try {
        server_thread_ = std::thread(&HttpServer::run, this);
    } catch (...) {
        running_.store(false);
        throw;
    }
}

void HttpServer::stop() {
    running_.store(false);
    
    if (server_socket_ >= 0) {
        closeSocket(server_socket_);
        server_socket_ = -1;
    }
    
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
}

void HttpServer::run() {
    server_socket_ = socket(AF_INET, SOCK_STREAM, 0);
    if (server_socket_ < 0) {
        std::cerr << "Failed to create socket" << std::endl;
        running_.store(false);
        return;
    }
    
    // Allow socket reuse
    int opt = 1;
    #ifdef _WIN32
        setsockopt(server_socket_, SOL_SOCKET, SO_REUSEADDR, 
                   reinterpret_cast<const char*>(&opt), sizeof(opt));
    #else
        setsockopt(server_socket_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    #endif
    
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(port_);
    
    if (bind(server_socket_, reinterpret_cast<struct sockaddr*>(&server_addr), 
             sizeof(server_addr)) < 0) {
        std::cerr << "Failed to bind to port " << port_ << std::endl;
        closeSocket(server_socket_);
        running_.store(false);
        return;
    }
    
    if (listen(server_socket_, 10) < 0) {
        std::cerr << "Failed to listen" << std::endl;
        closeSocket(server_socket_);
        running_.store(false);
        return;
    }
    
    std::cout << "HTTP server listening on port " << port_ << std::endl;
    
    while (running_.load()) {
        struct sockaddr_in client_addr;
        #ifdef _WIN32
            int client_len = sizeof(client_addr);
        #else
            socklen_t client_len = sizeof(client_addr);
        #endif
        
        int client_socket = accept(server_socket_, 
                                   reinterpret_cast<struct sockaddr*>(&client_addr), 
                                   &client_len);
        
        if (client_socket < 0) {
            if (running_.load()) {
                std::cerr << "Failed to accept connection" << std::endl;
            }
            continue;
        }
        
        // Set socket timeout
        if (!setSocketTimeout(client_socket, SOCKET_TIMEOUT_MS)) {
            std::cerr << "Warning: Failed to set socket timeout" << std::endl;
        }
        
        // Handle client in a detached thread
        std::thread client_thread(&HttpServer::handleClient, this, client_socket);
        client_thread.detach();
    }
    
    closeSocket(server_socket_);
}

void HttpServer::handleClient(int client_socket) {
    char buffer[4096];
    std::string request;
    size_t total_received = 0;
    
    // Read HTTP request with size limit
    while (total_received < MAX_REQUEST_SIZE) {
        size_t remaining = MAX_REQUEST_SIZE - total_received;
        int to_read = static_cast<int>(std::min<size_t>(sizeof(buffer), remaining));
        int received = recv(client_socket, buffer, to_read, 0);
        
        if (received <= 0) {
            break;
        }
        
        request.append(buffer, received);
        total_received += static_cast<size_t>(received);
        
        // Check if we have complete headers
        if (request.find("\r\n\r\n") != std::string::npos) {
            break;
        }
    }
    
    if (request.empty() || total_received >= MAX_REQUEST_SIZE) {
        // Request too large or empty
        const char* response = "HTTP/1.1 413 Payload Too Large\r\n"
                              "Content-Length: 17\r\n"
                              "\r\nPayload Too Large";
        send(client_socket, response, static_cast<int>(strlen(response)), 0);
        closeSocket(client_socket);
        return;
    }
    
    // Parse request line
    size_t line_end = request.find("\r\n");
    if (line_end == std::string::npos) {
        closeSocket(client_socket);
        return;
    }
    
    std::string request_line = request.substr(0, line_end);
    
    // Parse method and path
    size_t method_end = request_line.find(' ');
    size_t path_end = request_line.find(' ', method_end + 1);
    
    if (method_end == std::string::npos || path_end == std::string::npos) {
        closeSocket(client_socket);
        return;
    }
    
    std::string method = request_line.substr(0, method_end);
    std::string path = request_line.substr(method_end + 1, path_end - method_end - 1);
    
    // Extract headers and body
    std::string headers = request.substr(0, request.find("\r\n\r\n") + 2);
    std::string body = request.substr(request.find("\r\n\r\n") + 4);
    
    // Check Content-Length for body size limit
    size_t content_length = getContentLength(headers);
    if (content_length > MAX_BODY_SIZE) {
        const char* response = "HTTP/1.1 413 Payload Too Large\r\n"
                              "Content-Type: text/plain\r\n"
                              "Content-Length: 17\r\n"
                              "\r\nPayload Too Large";
        send(client_socket, response, static_cast<int>(strlen(response)), 0);
        closeSocket(client_socket);
        return;
    }
    
    // Call callback to handle request
    std::string response = callback_(method, path, body);
    
    // Send response
    send(client_socket, response.c_str(), static_cast<int>(response.length()), 0);
    
    closeSocket(client_socket);
}

}  // namespace log_queue
