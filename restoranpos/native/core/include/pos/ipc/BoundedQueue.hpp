#pragma once

#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>

namespace pos::ipc {

/**
 * Blocking queue with a hard capacity.
 *
 * The cap is the anti-hang mechanism: an unbounded queue under load grows until
 * the process dies of memory exhaustion, whereas a full bounded queue lets the
 * caller reject the request immediately with a retryable error. Failing fast is
 * what stops the UI from showing a spinner that never resolves.
 */
template <typename T>
class BoundedQueue {
public:
    explicit BoundedQueue(std::size_t capacity) : capacity_(capacity) {}

    /** Non-blocking push; false means the queue is full. */
    bool tryPush(T value) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (closed_ || items_.size() >= capacity_) return false;
            items_.push_back(std::move(value));
        }
        notEmpty_.notify_one();
        return true;
    }

    /** Blocks until an item is available or the queue is closed. */
    std::optional<T> pop() {
        std::unique_lock<std::mutex> lock(mutex_);
        notEmpty_.wait(lock, [this] { return closed_ || !items_.empty(); });

        if (items_.empty()) return std::nullopt;  // closed and drained

        T value = std::move(items_.front());
        items_.pop_front();
        return value;
    }

    /** Non-blocking pop; nullopt when nothing is queued. */
    std::optional<T> tryPop() {
        std::lock_guard<std::mutex> lock(mutex_);
        if (items_.empty()) return std::nullopt;
        T value = std::move(items_.front());
        items_.pop_front();
        return value;
    }

    /** Wakes every waiter; pop() drains what remains and then returns nullopt. */
    void close() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            closed_ = true;
        }
        notEmpty_.notify_all();
    }

    std::size_t size() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return items_.size();
    }

    bool closed() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return closed_;
    }

private:
    mutable std::mutex mutex_;
    std::condition_variable notEmpty_;
    std::deque<T> items_;
    std::size_t capacity_;
    bool closed_ = false;
};

}  // namespace pos::ipc
