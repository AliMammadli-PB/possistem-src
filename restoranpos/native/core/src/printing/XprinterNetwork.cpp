#include "pos/printing/XprinterNetwork.hpp"
#include "pos/Error.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <typeinfo>
#ifdef _WIN32
#define NOMINMAX
#include <filesystem>
#include <windows.h>
#include <iphlpapi.h>
#include <icmpapi.h>
#include <cstring>
#include <vector>
#endif
namespace pos::printing {
namespace {
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
// SearchEscNetDevice takes an MSVC `std::function<void(unsigned char*)>` by value
// (a pointer to a 64-byte object whose last word points at the callable's vtable
// holder), not a plain function pointer: the DLL is MSVC-built, this core is not.
// The SDK copies it (_Copy), calls _Do_call with a pointer to the argument and
// destroys it (_Delete_this), so a hand-built object with that vtable is enough.
struct MsvcCallback {
  const void *const *vtable;
};
void *__cdecl callbackCopy(MsvcCallback *self, void *where) {
  static_cast<MsvcCallback *>(where)->vtable = self->vtable;
  return where;
}
void __cdecl callbackCall(MsvcCallback *, unsigned char **arg) { discovered(*arg); }
const void *__cdecl callbackType(MsvcCallback *) { return &typeid(void); }
void __cdecl callbackDelete(MsvcCallback *, bool) {}
const void *__cdecl callbackGet(MsvcCallback *) { return nullptr; }
// _Copy, _Move, _Do_call, _Target_type, _Delete_this, _Get (MSVC _Func_base order).
const void *const callbackVtable[] = {
    reinterpret_cast<const void *>(&callbackCopy), reinterpret_cast<const void *>(&callbackCopy),
    reinterpret_cast<const void *>(&callbackCall), reinterpret_cast<const void *>(&callbackType),
    reinterpret_cast<const void *>(&callbackDelete), reinterpret_cast<const void *>(&callbackGet)};
struct alignas(16) MsvcFunction {
  void *words[8]{};
  MsvcFunction() {
    words[0] = const_cast<void *>(static_cast<const void *>(callbackVtable));
    words[7] = &words[0];
  }
};
// This PC's IPv4 networks that have a gateway: the UI offers "match this
// computer's network" from them when the printer sits on another subnet.
Json localAdapters() {
  Json out = Json::array();
  ULONG size = 0;
  if (GetAdaptersInfo(nullptr, &size) != ERROR_BUFFER_OVERFLOW)
    return out;
  std::vector<unsigned char> buffer(size);
  auto *info = reinterpret_cast<IP_ADAPTER_INFO *>(buffer.data());
  if (GetAdaptersInfo(info, &size) != NO_ERROR)
    return out;
  for (auto *a = info; a; a = a->Next) {
    const std::string ip = a->IpAddressList.IpAddress.String,
                      mask = a->IpAddressList.IpMask.String,
                      gateway = a->GatewayList.IpAddress.String;
    if (ip.empty() || ip == "0.0.0.0" || gateway.empty() || gateway == "0.0.0.0")
      continue;
    out.push_back(Json{{"ip", ip}, {"mask", mask}, {"gateway", gateway}});
  }
  return out;
}
// A device already answering on the new address would collide with the printer.
bool answersPing(const std::string &text) {
  const auto address = ipv4(text);
  HANDLE icmp = IcmpCreateFile();
  if (icmp == INVALID_HANDLE_VALUE)
    return false;
  IPAddr destination;
  std::memcpy(&destination, address.data(), 4);
  char data[8] = {};
  std::vector<unsigned char> reply(sizeof(ICMP_ECHO_REPLY) + sizeof(data) + 8);
  bool answered = false;
  for (int attempt = 0; attempt < 2 && !answered; ++attempt)
    answered = IcmpSendEcho(icmp, destination, data, sizeof(data), nullptr, reply.data(),
                            static_cast<DWORD>(reply.size()), 700) > 0 &&
               reinterpret_cast<ICMP_ECHO_REPLY *>(reply.data())->Status == IP_SUCCESS;
  IcmpCloseHandle(icmp);
  return answered;
}
class Sdk {
  HMODULE module = nullptr;

public:
  using Search = int(__cdecl *)(int, MsvcFunction *);
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
    MsvcFunction callback;
    const int rc = search(3, &callback);
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
  return Json{{"devices", sdk.scan()}, {"adapters", localAdapters()}};
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
  require(checked["ip"] == checked["oldIp"] || !answersPing(checked["ip"]),
          "Bu IP artıq şəbəkədə başqa cihazdadır. Başqa IP seçin.");
  auto mac = macBytes(checked["mac"].get<std::string>());
  auto ip = ipv4(checked["ip"]), mask = ipv4(checked["mask"]),
       gateway = ipv4(checked["gateway"]);
  const auto rc =
      sdk.set(mac.data(), ip.data(), mask.data(), gateway.data(), 0);
  require(rc == 0, "Xprinter əmri göndərilmədi. Kod: " + std::to_string(rc));
  // The printer restarts its network stack after the change; a real Ethernet
  // Xprinter on 2026-10-30 reported the new settings only after the first 2 s read-back.
  bool verified = false;
  for (int attempt = 0; attempt < 5 && !verified; ++attempt) {
    std::this_thread::sleep_for(std::chrono::seconds(2));
    try {
      for (const auto &d : sdk.scan())
        if (d["mac"] == checked["mac"] && d["ip"] == checked["ip"] &&
            d["mask"] == checked["mask"] && d["gateway"] == checked["gateway"] &&
            !d.value("dhcp", true))
          verified = true;
    } catch (...) { /* A sent command is not proof that the device applied it. */
    }
  }
  return Json{{"sent", true}, {"verified", verified}, {"settings", checked}};
#else
  throw PosError("E_VALIDATION",
                 "Xprinter şəbəkə sazlaması Windows-da işləyir");
#endif
}
} // namespace pos::printing
