cmake_minimum_required(VERSION 3.16)
project(log_agent VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(log_agent
    src/main.cpp
    src/file_tailer.cpp
    src/log_parser.cpp
    src/batcher.cpp
    src/queue_client.cpp
)

target_include_directories(log_agent PRIVATE ${CMAKE_SOURCE_DIR}/include)

if(WIN32)
    target_link_libraries(log_agent PRIVATE ws2_32)
endif()
