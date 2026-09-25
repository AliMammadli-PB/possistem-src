#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pos::crypto {

/** Cryptographically secure random bytes (BCryptGenRandom on Windows). */
std::vector<std::uint8_t> randomBytes(std::size_t count);

std::string toHex(const std::vector<std::uint8_t>& bytes);
std::vector<std::uint8_t> fromHex(const std::string& hex);

/** RFC 4122 version 4 UUID, lower-case with dashes. */
std::string uuid4();

/** Short human-facing reference such as an order number: e.g. "A7F3K2". */
std::string shortCode(std::size_t length = 6);

/**
 * PIN storage.
 *
 * PBKDF2-HMAC-SHA256 with a per-user random salt. PINs are short and
 * low-entropy by nature, so a deliberately expensive KDF plus rate limiting at
 * the IPC layer is what makes them survivable. Plain text is never stored,
 * logged, or returned.
 *
 * Encoded as: pbkdf2$sha256$<iterations>$<saltHex>$<hashHex>
 */
std::string hashPin(const std::string& pin);

/** Constant-time verification against an encoded hash. */
bool verifyPin(const std::string& pin, const std::string& encoded);

/** SHA-256 hex digest, used for idempotency request fingerprints. */
std::string sha256Hex(const std::string& input);

}  // namespace pos::crypto
