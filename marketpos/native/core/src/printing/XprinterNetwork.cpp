#include "market/printing/XprinterNetwork.hpp"
#include "market/Error.hpp"
#include <string>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#ifdef _WIN32
#define NOMINMAX
#include <filesystem>
#include <windows.h>
#endif
namespace market::printing {
namespace {
using Json = nlohmann::json;
void require(bool ok, const std::string &message) {
  if (!ok) throw PosError("E_VALIDATION", message);
}
template <class T> T getOr(const Json &j, const char *key, T fallback) {
  return j.is_object() && j.contains(key) && !j.at(key).is_null() ? j.at(key).get<T>() : fallback;
}
std::array<unsigned char, 4> ipv4(const std::string &text) {
  std::array<unsigned char, 4> out{};
  unsigned v[4];
  char extra;
  require(std::sscanf(text.c_str(), "%u.%u.%u.%u%c", &v[0], &v[1], &v[2], &v[3],
                      &extra) == 4,
          "IPv4 ünvanı düzgün deyil");
  for (int i = 0; i < 4; ++i) {
    require(v[i] <= 255, "IPv4 ünvanı düzgün deyil");
    out[i] = static_cast<unsigned char>(v[i]);
  }
  require(text == std::to_string(v[0]) + "." + std::to_string(v[1]) + "." +
                      std::to_string(v[2]) + "." + std::to_string(v[3]),
          "IPv4 ünvanı düzgün deyil");
  return out;
}
std::uint32_t number(const std::array<unsigned char, 4> &a) {
  return (std::uint32_t(a[0]) << 24) | (std::uint32_t(a[1]) << 16) |
         (std::uint32_t(a[2]) << 8) | a[3];
}
bool local(const std::array<unsigned char, 4> &a) {
  return a[0] == 10 || (a[0] == 172 && a[1] >= 16 && a[1] <= 31) ||
         (a[0] == 192 && a[1] == 168);
}
std::array<unsigned char, 6> macBytes(const std::string &text) {
  std::array<unsigned char, 6> out{};
  unsigned v[6];
  char extra;
  require(text.size() == 17 &&
              std::sscanf(text.c_str(), "%2x:%2x:%2x:%2x:%2x:%2x%c", &v[0],
                          &v[1], &v[2], &v[3], &v[4], &v[5], &extra) == 6,
          "MAC ünvanı düzgün deyil");
  for (int i = 0; i < 6; ++i)
    out[i] = static_cast<unsigned char>(v[i]);
  require((out[0] & 1) == 0 && std::any_of(out.begin(), out.end(),
                                           [](auto b) { return b != 0; }),
          "MAC ünvanı düzgün deyil");
  return out;
}
#ifdef _WIN32
std::mutex operationMutex, resultMutex;
Json found = Json::array();
std::string ipText(const unsigned char *p) {
  return std::to_string(p[0]) + "." + std::to_string(p[1]) + "." +
         std::to_string(p[2]) + "." + std::to_string(p[3]);
}
void __cdecl discovered(unsigned char *data) {
  if (!data)
    return;
  char mac[18];
  std::snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X", data[0],
                data[1], data[2], data[3], data[4], data[5]);
  std::lock_guard lock(resultMutex);
  for (const auto &item : found)
    if (item["mac"] == mac)
      return;
  found.push_back(Json{{"mac", mac},
                       {"ip", ipText(data + 8)},
                       {"mask", ipText(data + 12)},
                       {"gateway", ipText(data + 16)},
                       {"dhcp", data[22] != 0}});
}
class Sdk {
  HMODULE module = nullptr;

public:
  using Search = int(__cdecl *)(int, void(__cdecl *)(unsigned char *));
  using Set = int(__cdecl *)(unsigned char *, unsigned char *, unsigned char *,
                             unsigned char *, unsigned char);
  Search search = nullptr;
  Set set = nullptr;
  Sdk() {
    std::wstring exe(32768, L'\0');
    const auto count =
        GetModuleFileNameW(nullptr, exe.data(), static_cast<DWORD>(exe.size()));
    require(count > 0 && count < exe.size(), "SDK yolu alınmadı");
    exe.resize(count);
    const auto file =
        std::filesystem::path(exe).parent_path() / L"printer.sdk.dll";
    module = LoadLibraryExW(file.c_str(), nullptr,
                            LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
                                LOAD_LIBRARY_SEARCH_SYSTEM32);
    require(module != nullptr,
            "Xprinter SDK tapılmadı. Quraşdırıcını yenidən quraşdırın.");
    search =
        reinterpret_cast<Search>(GetProcAddress(module, "SearchEscNetDevice"));
    set = reinterpret_cast<Set>(GetProcAddress(module, "SetEscNetInfo"));
    if (!search || !set) {
      FreeLibrary(module);
      module = nullptr;
      throw PosError("E_VALIDATION", "Xprinter SDK versiyası uyğun deyil");
    }
  }
  ~Sdk() {
    if (module)
      FreeLibrary(module);
  }
  Json scan() {
    {
      std::lock_guard lock(resultMutex);
      found = Json::array();
    }
    const int rc = search(3, discovered);
    require(rc == 0, "Xprinter axtarışı alınmadı. Şəbəkə və firewall icazəsini "
                     "yoxlayın. Kod: " +
                         std::to_string(rc));
    std::lock_guard lock(resultMutex);
    return found;
  }
};
#endif
} // namespace
Json validateXprinterNetwork(const Json &input) {
  auto ip = ipv4(getOr<std::string>(input, "ip", "")),
       mask = ipv4(getOr<std::string>(input, "mask", "")),
       gateway = ipv4(getOr<std::string>(input, "gateway", ""));
  auto old = ipv4(getOr<std::string>(input, "oldIp", ""));
  require(local(ip) && local(old), "Printer üçün yerli şəbəkə IP-si yazın");
  const auto m = number(mask), host = ~m;
  require(m != 0 && host >= 3 && (host & (host + 1)) == 0,
          "Alt şəbəkə maskası düzgün deyil");
  require((number(ip) & host) != 0 && (number(ip) & host) != host,
          "IP şəbəkə və yayım ünvanı ola bilməz");
  require(number(gateway) == 0 ||
              (local(gateway) && (number(ip) & m) == (number(gateway) & m) &&
               number(ip) != number(gateway) && (number(gateway) & host) != 0 &&
               (number(gateway) & host) != host),
          "Gateway yeni IP ilə eyni alt şəbəkədə olmalıdır");
  const auto mac = macBytes(getOr<std::string>(input, "mac", ""));
  char normalized[18];
  std::snprintf(normalized, sizeof(normalized), "%02X:%02X:%02X:%02X:%02X:%02X",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return Json{{"mac", normalized},
              {"oldIp", input.at("oldIp")},
              {"ip", input.at("ip")},
              {"mask", input.at("mask")},
              {"gateway", input.at("gateway")}};
}
bool xprinterSdkAvailable() {
#ifdef _WIN32
  Sdk sdk; return true;
#else
  return false;
#endif
}
Json scanXprinterNetwork() {
#ifdef _WIN32
  std::lock_guard lock(operationMutex);
  Sdk sdk;
  return Json{{"devices", sdk.scan()}};
#else
  throw PosError("E_VALIDATION",
                 "Xprinter şəbəkə sazlaması Windows-da işləyir");
#endif
}
Json configureXprinterNetwork(const Json &input) {
  const auto checked = validateXprinterNetwork(input);
  require(getOr<bool>(input, "confirmed", false),
          "Şəbəkə dəyişikliyini təsdiqləyin");
#ifdef _WIN32
  std::lock_guard lock(operationMutex);
  Sdk sdk;
  const auto devices = sdk.scan();
  bool present = false;
  for (const auto &d : devices)
    if (d["mac"] == checked["mac"] && d["ip"] == checked["oldIp"])
      present = true;
  require(present, "Printer dəyişib və ya tapılmadı. Yenidən axtarın.");
  auto mac = macBytes(checked["mac"].get<std::string>());
  auto ip = ipv4(checked["ip"]), mask = ipv4(checked["mask"]),
       gateway = ipv4(checked["gateway"]);
  const auto rc =
      sdk.set(mac.data(), ip.data(), mask.data(), gateway.data(), 0);
  require(rc == 0, "Xprinter əmri göndərilmədi. Kod: " + std::to_string(rc));
  std::this_thread::sleep_for(std::chrono::seconds(2));
  bool verified = false;
  try {
    for (const auto &d : sdk.scan())
      if (d["mac"] == checked["mac"] && d["ip"] == checked["ip"] &&
          d["mask"] == checked["mask"] && d["gateway"] == checked["gateway"] &&
          !d.value("dhcp", true))
        verified = true;
  } catch (...) { /* A sent command is not proof that the device applied it. */
  }
  return Json{{"sent", true}, {"verified", verified}, {"settings", checked}};
#else
  throw PosError("E_VALIDATION",
                 "Xprinter şəbəkə sazlaması Windows-da işləyir");
#endif
}
} // namespace market::printing
