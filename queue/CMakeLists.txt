cmake_minimum_required(VERSION 3.16)
project(log_queue VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(log_queue
    src/main.cpp
    src/queue.cpp
    src/persistence.cpp
    src/http_server.cpp
)

target_include_directories(log_queue PRIVATE ${CMAKE_SOURCE_DIR}/include)

if(WIN32)
    target_link_libraries(log_queue PRIVATE ws2_32)
endif()
