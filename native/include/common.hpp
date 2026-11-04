#pragma once
#include <atomic>
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <nlohmann/json.hpp>
#include <picosha2.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif
namespace pipeline {
using json = nlohmann::json;
inline std::atomic<bool> stopped{false};
static_assert(std::atomic<bool>::is_always_lock_free);
inline void signal_handler(int) { stopped.store(true, std::memory_order_relaxed); }
inline void signals() { std::signal(SIGINT, signal_handler); std::signal(SIGTERM, signal_handler); }
inline std::string option(int argc, char** argv, const std::string& key, const std::string& fallback) {
  for (int i = 1; i < argc; ++i) if (argv[i] == key) { if (++i >= argc) throw std::runtime_error("Missing " + key); return argv[i]; }
  return fallback;
}
inline unsigned number(const std::string& text, unsigned lo, unsigned hi) {
  size_t used = 0; auto n = std::stoull(text, &used);
  if (used != text.size() || n < lo || n > hi) throw std::runtime_error("Invalid numeric option: " + text);
  return static_cast<unsigned>(n);
}
inline std::string fingerprint(const std::string& text) {return picosha2::hash256_hex_string(text);}
inline void atomic_write(const std::filesystem::path& path, const std::string& text) {
  if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path());
  auto tmp = path; tmp += ".tmp";
  { std::ofstream stream(tmp, std::ios::binary | std::ios::trunc); stream << text; stream.flush(); if (!stream) throw std::runtime_error("Cannot write checkpoint"); }
#ifdef _WIN32
  HANDLE handle = CreateFileW(tmp.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) throw std::runtime_error("Cannot open checkpoint");
  bool ok = FlushFileBuffers(handle); CloseHandle(handle);
  if (!ok || !MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Cannot persist checkpoint");
#else
  int fd = ::open(tmp.c_str(), O_RDONLY);
  if (fd < 0) throw std::runtime_error("Cannot open checkpoint");
  int result = ::fsync(fd); ::close(fd);
  if (result != 0) throw std::runtime_error("Cannot sync checkpoint");
  std::filesystem::rename(tmp, path);
  fd = ::open((path.has_parent_path() ? path.parent_path() : std::filesystem::path(".")).c_str(), O_RDONLY);
  if (fd < 0) throw std::runtime_error("Cannot open checkpoint directory");
  result = ::fsync(fd); ::close(fd);
  if (result != 0) throw std::runtime_error("Cannot sync checkpoint directory");
#endif
}
}
