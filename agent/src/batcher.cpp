#include "batcher.hpp"
#include <stdexcept>

namespace log_agent {

Batcher::Batcher(size_t batchSize, std::chrono::milliseconds flushInterval,
                 BatchCallback callback)
    : batch_size_(batchSize),
      flush_interval_(flushInterval),
      callback_(std::move(callback)) {
  if (batchSize == 0) {
    throw std::invalid_argument("batchSize must be greater than 0");
  }
  if (flushInterval.count() <= 0) {
    throw std::invalid_argument("flushInterval must be positive");
  }
  flusher_thread_ = std::thread(&Batcher::runFlusher, this);
}

Batcher::~Batcher() {
  running_.store(false, std::memory_order_release);
  cv_.notify_one();
  if (flusher_thread_.joinable()) {
    flusher_thread_.join();
  }
  try {
    flush();
  } catch (...) {
    // Destructor must not throw - swallow any exceptions from callback
  }
}

void Batcher::add(const std::string& item) {
  std::unique_lock<std::mutex> lock(mutex_);
  items_.push(item);
  bool shouldFlush = items_.size() >= batch_size_;
  lock.unlock();
  if (shouldFlush) {
    flush();
  }
}

void Batcher::add(std::string&& item) {
  std::unique_lock<std::mutex> lock(mutex_);
  items_.push(std::move(item));
  bool shouldFlush = items_.size() >= batch_size_;
  lock.unlock();
  if (shouldFlush) {
    flush();
  }
}

void Batcher::flush() {
  std::vector<std::string> batch;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    batch.reserve(items_.size());
    while (!items_.empty()) {
      batch.push_back(std::move(items_.front()));
      items_.pop();
    }
  }
  if (!batch.empty() && callback_) {
    callback_(batch);
  }
}
void Batcher::runFlusher() {
  auto nextFlush = std::chrono::steady_clock::now() + flush_interval_;
  while (running_.load(std::memory_order_relaxed)) {
    std::unique_lock<std::mutex> lock(mutex_);
    cv_.wait_until(lock, nextFlush,
                   [this] { return !running_.load(std::memory_order_relaxed); });
    lock.unlock();
    if (!running_.load(std::memory_order_relaxed)) {
      break;
    }
    try {
      flush();
    } catch (...) {
      // Continue running even if callback throws - prevents thread termination
    }
    nextFlush = std::chrono::steady_clock::now() + flush_interval_;
  }
}
}  // namespace log_agent