cmake_minimum_required(VERSION 3.16)
project(log_queue VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Fetch dependencies
include(FetchContent)

# SQLite3
FetchContent_Declare(
    sqlite3
    URL https://www.sqlite.org/2024/sqlite-amalgamation-3450000.zip
    URL_HASH SHA256=bde30d13ebdf84926ddd5e8b6df145be03a577a48fd075a087a5dd815bcdf740
)

# nlohmann/json
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
    GIT_SHALLOW TRUE
)

FetchContent_MakeAvailable(sqlite3 json)

# SQLite3 library from fetched content
add_library(sqlite3 STATIC
    ${sqlite3_SOURCE_DIR}/sqlite3.c
)

target_include_directories(sqlite3 PUBLIC ${sqlite3_SOURCE_DIR})

# Disable warnings for SQLite
if(MSVC)
    target_compile_options(sqlite3 PRIVATE /W0)
else()
    target_compile_options(sqlite3 PRIVATE -w)
endif()

add_executable(log_queue
    src/main.cpp
    src/sqlite_queue.cpp
    src/http_server.cpp
)

target_include_directories(log_queue PRIVATE 
    ${CMAKE_SOURCE_DIR}/include
)

target_link_libraries(log_queue PRIVATE sqlite3 nlohmann_json::nlohmann_json)

if(WIN32)
    target_link_libraries(log_queue PRIVATE ws2_32)
endif()

# Create data directory
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/data)
