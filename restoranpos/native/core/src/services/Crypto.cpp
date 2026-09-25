#include "pos/Crypto.hpp"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstring>
#include <random>
#include <stdexcept>

#ifdef _WIN32
#include <windows.h>
// bcrypt.h must follow windows.h
#include <bcrypt.h>
#ifndef NT_SUCCESS
#define NT_SUCCESS(Status) (((NTSTATUS)(Status)) >= 0)
#endif
#endif

namespace pos::crypto {
namespace {

constexpr std::uint32_t kIterations = 120000;
constexpr std::size_t kSaltBytes = 16;
constexpr std::size_t kHashBytes = 32;

#ifdef _WIN32

std::vector<std::uint8_t> pbkdf2(const std::string& password,
                                 const std::vector<std::uint8_t>& salt,
                                 std::uint32_t iterations,
                                 std::size_t outputBytes) {
    BCRYPT_ALG_HANDLE alg = nullptr;
    NTSTATUS status = BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr,
                                                  BCRYPT_ALG_HANDLE_HMAC_FLAG);
    if (!NT_SUCCESS(status)) throw std::runtime_error("BCryptOpenAlgorithmProvider failed");

    std::vector<std::uint8_t> out(outputBytes, 0);
    status = BCryptDeriveKeyPBKDF2(
        alg,
        reinterpret_cast<PUCHAR>(const_cast<char*>(password.data())),
        static_cast<ULONG>(password.size()),
        const_cast<PUCHAR>(salt.data()),
        static_cast<ULONG>(salt.size()),
        iterations,
        out.data(),
        static_cast<ULONG>(out.size()),
        0);

    BCryptCloseAlgorithmProvider(alg, 0);
    if (!NT_SUCCESS(status)) throw std::runtime_error("BCryptDeriveKeyPBKDF2 failed");
    return out;
}

std::vector<std::uint8_t> sha256(const std::string& input) {
    BCRYPT_ALG_HANDLE alg = nullptr;
    if (!NT_SUCCESS(BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) {
        throw std::runtime_error("BCryptOpenAlgorithmProvider(SHA256) failed");
    }

    std::vector<std::uint8_t> digest(kHashBytes, 0);
    NTSTATUS status = BCryptHash(
        alg, nullptr, 0,
        reinterpret_cast<PUCHAR>(const_cast<char*>(input.data())),
        static_cast<ULONG>(input.size()),
        digest.data(), static_cast<ULONG>(digest.size()));

    BCryptCloseAlgorithmProvider(alg, 0);
    if (!NT_SUCCESS(status)) throw std::runtime_error("BCryptHash failed");
    return digest;
}

#else  // portable fallback - development convenience only

std::vector<std::uint8_t> pbkdf2(const std::string& password,
                                 const std::vector<std::uint8_t>& salt,
                                 std::uint32_t,
                                 std::size_t outputBytes) {
    std::vector<std::uint8_t> out(outputBytes, 0);
    std::size_t i = 0;
    for (char c : password) out[i++ % outputBytes] ^= static_cast<std::uint8_t>(c);
    for (auto b : salt) out[i++ % outputBytes] ^= b;
    return out;
}

std::vector<std::uint8_t> sha256(const std::string& input) {
    std::vector<std::uint8_t> out(kHashBytes, 0);
    std::size_t i = 0;
    for (char c : input) out[i++ % kHashBytes] ^= static_cast<std::uint8_t>(c);
    return out;
}

#endif

}  // namespace

std::vector<std::uint8_t> randomBytes(std::size_t count) {
    std::vector<std::uint8_t> buffer(count);
#ifdef _WIN32
    if (!NT_SUCCESS(BCryptGenRandom(nullptr, buffer.data(), static_cast<ULONG>(buffer.size()),
                                    BCRYPT_USE_SYSTEM_PREFERRED_RNG))) {
        throw std::runtime_error("BCryptGenRandom failed");
    }
#else
    std::random_device rd;
    for (auto& b : buffer) b = static_cast<std::uint8_t>(rd() & 0xFF);
#endif
    return buffer;
}

std::string toHex(const std::vector<std::uint8_t>& bytes) {
    static constexpr char kDigits[] = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (auto b : bytes) {
        out.push_back(kDigits[b >> 4]);
        out.push_back(kDigits[b & 0x0F]);
    }
    return out;
}

std::vector<std::uint8_t> fromHex(const std::string& hex) {
    auto nibble = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };

    std::vector<std::uint8_t> out;
    out.reserve(hex.size() / 2);
    for (std::size_t i = 0; i + 1 < hex.size(); i += 2) {
        const int hi = nibble(hex[i]);
        const int lo = nibble(hex[i + 1]);
        if (hi < 0 || lo < 0) return {};
        out.push_back(static_cast<std::uint8_t>((hi << 4) | lo));
    }
    return out;
}

std::string uuid4() {
    auto bytes = randomBytes(16);
    bytes[6] = static_cast<std::uint8_t>((bytes[6] & 0x0F) | 0x40);  // version 4
    bytes[8] = static_cast<std::uint8_t>((bytes[8] & 0x3F) | 0x80);  // variant 1

    const std::string hex = toHex(bytes);
    return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" +
           hex.substr(16, 4) + "-" + hex.substr(20, 12);
}

std::string shortCode(std::size_t length) {
    // Excludes I, O, 0, 1 so a code read aloud across a noisy dining room is
    // unambiguous.
    static constexpr char kAlphabet[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    constexpr std::size_t kAlphabetSize = sizeof(kAlphabet) - 1;

    auto bytes = randomBytes(length);
    std::string out;
    out.reserve(length);
    for (auto b : bytes) out.push_back(kAlphabet[b % kAlphabetSize]);
    return out;
}

std::string hashPin(const std::string& pin) {
    const auto salt = randomBytes(kSaltBytes);
    const auto hash = pbkdf2(pin, salt, kIterations, kHashBytes);
    return "pbkdf2$sha256$" + std::to_string(kIterations) + "$" + toHex(salt) + "$" + toHex(hash);
}

bool verifyPin(const std::string& pin, const std::string& encoded) {
    // pbkdf2$sha256$<iterations>$<saltHex>$<hashHex>
    std::array<std::string, 5> parts;
    std::size_t index = 0;
    std::size_t start = 0;
    for (std::size_t i = 0; i <= encoded.size() && index < parts.size(); ++i) {
        if (i == encoded.size() || encoded[i] == '$') {
            parts[index++] = encoded.substr(start, i - start);
            start = i + 1;
        }
    }
    if (index != 5 || parts[0] != "pbkdf2" || parts[1] != "sha256") return false;

    std::uint32_t iterations = 0;
    try {
        iterations = static_cast<std::uint32_t>(std::stoul(parts[2]));
    } catch (...) {
        return false;
    }
    if (iterations == 0) return false;

    const auto salt = fromHex(parts[3]);
    const auto expected = fromHex(parts[4]);
    if (salt.empty() || expected.empty()) return false;

    std::vector<std::uint8_t> actual;
    try {
        actual = pbkdf2(pin, salt, iterations, expected.size());
    } catch (...) {
        return false;
    }

    // Constant time: comparing with == would leak how many leading bytes matched.
    if (actual.size() != expected.size()) return false;
    std::uint8_t diff = 0;
    for (std::size_t i = 0; i < actual.size(); ++i) diff |= (actual[i] ^ expected[i]);
    return diff == 0;
}

std::string sha256Hex(const std::string& input) {
    return toHex(sha256(input));
}

}  // namespace pos::crypto
