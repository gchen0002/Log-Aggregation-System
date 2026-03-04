cmake_minimum_required(VERSION 3.16)
project(log_agent VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Fetch nlohmann/json library
include(FetchContent)
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(json)

# For now, build as a library since main.cpp doesn't exist yet
# TODO: Change back to executable once all files are implemented
add_library(log_agent_lib STATIC
    src/log_parser.cpp
    src/batcher.cpp
    src/file_tailer.cpp
)

# Uncomment when main.cpp exists:
# add_executable(log_agent
#     src/main.cpp
#     src/file_tailer.cpp
#     src/log_parser.cpp
#     src/batcher.cpp
#     src/queue_client.cpp
# )

target_include_directories(log_agent_lib PRIVATE ${CMAKE_SOURCE_DIR}/include)

target_link_libraries(log_agent_lib PRIVATE nlohmann_json::nlohmann_json)

if(WIN32)
    target_link_libraries(log_agent_lib PRIVATE ws2_32)
endif()

# Uncomment when executable is ready:
# target_include_directories(log_agent PRIVATE ${CMAKE_SOURCE_DIR}/include)
# target_link_libraries(log_agent PRIVATE nlohmann_json::nlohmann_json nlohmann_json::nlohmann_json)
# if(WIN32)
#     target_link_libraries(log_agent PRIVATE ws2_32)
# endif()
