#include "pos/printing/XprinterNetwork.hpp"
#include "pos/Error.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <cstring>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mstcpip.h>
#ifndef SIO_UDP_CONNRESET // missing from mingw-w64 headers
#define SIO_UDP_CONNRESET _WSAIOW(IOC_VENDOR, 12)
#endif
#include <windows.h>
#include <iphlpapi.h>
#include <icmpapi.h>
#else
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
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
// Own protocol (1.9.23). The SDK's SearchEscNetDevice found nothing on a real
// Windows till that reached the same printer on TCP 9100, so neither the search
// nor the change goes through printer.sdk.dll any more. "XP0001FIND" goes to UDP 9000 as unicast to every host
// of this PC's subnets and as broadcasts; the printer always answers on port
// 9600 with "XP0001FOUND" + MAC 0..5, IPv4 8..11, mask 12..15, gateway 16..19,
// DHCP 22. A unicast reply returns on the flow the request opened, so Windows
// Firewall admits it without a rule; the broadcast covers another subnet.
// A change is "XP0001SAVE" + MAC + 22 00 + IP, mask, gateway + 8C 23 + DHCP,
// the bytes SetEscNetInfo sends, by broadcast: the printer matches its MAC.
#ifdef _WIN32
using Socket = SOCKET;
const Socket kNoSocket = INVALID_SOCKET;
void closeSocket(Socket s) { closesocket(s); }
#else
using Socket = int;
const Socket kNoSocket = -1;
void closeSocket(Socket s) { ::close(s); }
#endif
struct Subnet {
  std::uint32_t ip, mask; // host byte order
};
std::vector<Subnet> localSubnets() {
  std::vector<Subnet> out;
  const auto keep = [&out](std::uint32_t ip, std::uint32_t mask) {
    if (ip != 0 && (ip >> 24) != 127 && (ip >> 16) != 0xA9FE && mask != 0)
      out.push_back({ip, mask});
  };
#ifdef _WIN32
  ULONG size = 0;
  if (GetAdaptersInfo(nullptr, &size) != ERROR_BUFFER_OVERFLOW)
    return out;
  std::vector<unsigned char> buffer(size);
  auto *info = reinterpret_cast<IP_ADAPTER_INFO *>(buffer.data());
  if (GetAdaptersInfo(info, &size) != NO_ERROR)
    return out;
  for (auto *a = info; a; a = a->Next)
    for (auto *ip = &a->IpAddressList; ip; ip = ip->Next)
      keep(ntohl(inet_addr(ip->IpAddress.String)), ntohl(inet_addr(ip->IpMask.String)));
#else
  ifaddrs *list = nullptr;
  if (getifaddrs(&list) != 0)
    return out;
  for (auto *i = list; i; i = i->ifa_next)
    if (i->ifa_addr && i->ifa_netmask && i->ifa_addr->sa_family == AF_INET)
      keep(ntohl(reinterpret_cast<sockaddr_in *>(i->ifa_addr)->sin_addr.s_addr),
           ntohl(reinterpret_cast<sockaddr_in *>(i->ifa_netmask)->sin_addr.s_addr));
  freeifaddrs(list);
#endif
  return out;
}
std::string ipText(const unsigned char *p) {
  return std::to_string(p[0]) + "." + std::to_string(p[1]) + "." +
         std::to_string(p[2]) + "." + std::to_string(p[3]);
}
Json parseFound(const unsigned char *data, int size) {
  if (size < 11 + 23 || std::memcmp(data, "XP0001FOUND", 11) != 0)
    return nullptr;
  const unsigned char *d = data + 11;
  char mac[18];
  std::snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X", d[0], d[1], d[2],
                d[3], d[4], d[5]);
  return Json{{"mac", mac},
              {"ip", ipText(d + 8)},
              {"mask", ipText(d + 12)},
              {"gateway", ipText(d + 16)},
              {"dhcp", d[22] != 0}};
}
class Udp {
#ifdef _WIN32
  struct Winsock {
    Winsock() { WSADATA wsa; require(WSAStartup(MAKEWORD(2, 2), &wsa) == 0, "Şəbəkə açılmadı"); }
    ~Winsock() { WSACleanup(); }
  } winsock;
#endif
  Socket s = kNoSocket;

public:
  // The printer always answers on 9600, so the request has to leave from it.
  Udp() {
    s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    require(s != kNoSocket, "Xprinter üçün şəbəkə açılmadı");
    int yes = 1;
    setsockopt(s, SOL_SOCKET, SO_BROADCAST, reinterpret_cast<const char *>(&yes), sizeof(yes));
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char *>(&yes), sizeof(yes));
#ifdef _WIN32
    // Hosts in the sweep answer with ICMP port-unreachable; without this Windows
    // fails the next recv with WSAECONNRESET and the printer's reply is lost.
    BOOL report = FALSE;
    DWORD unused = 0;
    WSAIoctl(s, SIO_UDP_CONNRESET, &report, sizeof(report), nullptr, 0, &unused, nullptr, nullptr);
#endif
    sockaddr_in local{};
    local.sin_family = AF_INET;
    local.sin_port = htons(9600);
    local.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(s, reinterpret_cast<sockaddr *>(&local), sizeof(local)) != 0) {
      closeSocket(s);
      throw PosError("E_VALIDATION", "UDP 9600 portu başqa proqramdadır. Digər printer "
                                     "proqramlarını bağlayıb yenidən cəhd edin.");
    }
  }
  ~Udp() { closeSocket(s); }
  Udp(const Udp &) = delete;
  Udp &operator=(const Udp &) = delete;
  void send(const unsigned char *data, int size, const std::vector<std::uint32_t> &targets) {
    for (const auto target : targets) {
      sockaddr_in to{};
      to.sin_family = AF_INET;
      to.sin_port = htons(9000);
      to.sin_addr.s_addr = htonl(target);
      sendto(s, reinterpret_cast<const char *>(data), size, 0,
             reinterpret_cast<sockaddr *>(&to), sizeof(to));
    }
  }
  // -1 when nothing arrived in time; 0 for a datagram that failed to read.
  int receive(unsigned char *buffer, int size, long long waitMs) {
    fd_set ready;
    FD_ZERO(&ready);
    FD_SET(s, &ready);
    timeval wait{static_cast<long>(waitMs / 1000), static_cast<long>((waitMs % 1000) * 1000)};
    if (select(static_cast<int>(s) + 1, &ready, nullptr, nullptr, &wait) <= 0)
      return -1;
    const int n = recv(s, reinterpret_cast<char *>(buffer), size, 0);
    return n < 0 ? 0 : n;
  }
};
// The limited broadcast plus every local subnet's directed broadcast.
std::vector<std::uint32_t> broadcasts() {
  std::vector<std::uint32_t> out{0xFFFFFFFFu};
  for (const auto &n : localSubnets())
    out.push_back((n.ip & n.mask) | ~n.mask);
  return out;
}
Json discover() {
  Udp udp;
  // ponytail: unicast sweep only up to a /22 (1022 hosts); wider subnets rely on the broadcast.
  auto targets = broadcasts();
  for (const auto &n : localSubnets()) {
    const std::uint32_t hosts = ~n.mask, net = n.ip & n.mask;
    if (hosts <= 1023)
      for (std::uint32_t h = 1; h < hosts; ++h)
        if ((net | h) != n.ip)
          targets.push_back(net | h);
  }
  static const unsigned char probe[] = {'X', 'P', '0', '0', '0', '1', 'F', 'I', 'N', 'D'};
  udp.send(probe, sizeof(probe), targets);
  // A real XP printer skipped about one request in three (2026-10-30), so the
  // broadcasts repeat every 700 ms for 4 s.
  const auto again = broadcasts();
  Json found = Json::array();
  const auto start = std::chrono::steady_clock::now();
  int repeats = 0;
  for (;;) {
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - start)
                             .count();
    if (elapsed >= 4000)
      break;
    if (repeats < 4 && elapsed >= 700 * (repeats + 1)) {
      udp.send(probe, sizeof(probe), again);
      ++repeats;
    }
    unsigned char buffer[512];
    const auto next = repeats < 4 ? 700 * (repeats + 1) : 4000;
    const int n = udp.receive(buffer, sizeof(buffer), std::max<long long>(1, next - elapsed));
    const auto device = n > 0 ? parseFound(buffer, n) : Json(nullptr);
    if (device.is_null())
      continue;
    if (std::none_of(found.begin(), found.end(),
                     [&](const Json &d) { return d["mac"] == device["mac"]; }))
      found.push_back(device);
  }
  return found;
}
void sendSave(const Json &checked) {
  std::vector<unsigned char> packet{'X', 'P', '0', '0', '0', '1', 'S', 'A', 'V', 'E'};
  const auto mac = macBytes(checked["mac"].get<std::string>());
  packet.insert(packet.end(), mac.begin(), mac.end());
  packet.insert(packet.end(), {0x22, 0x00});
  for (const char *key : {"ip", "mask", "gateway"}) {
    const auto part = ipv4(checked[key].get<std::string>());
    packet.insert(packet.end(), part.begin(), part.end());
  }
  packet.insert(packet.end(), {0x8C, 0x23, 0x00}); // TCP 9100, static (no DHCP)
  auto targets = broadcasts();
  targets.push_back(number(ipv4(checked["oldIp"].get<std::string>())));
  Udp udp;
  udp.send(packet.data(), static_cast<int>(packet.size()), targets);
}
std::mutex operationMutex;
#ifdef _WIN32
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
Json scanXprinterNetwork() {
  std::lock_guard lock(operationMutex);
#ifdef _WIN32
  return Json{{"devices", discover()}, {"adapters", localAdapters()}};
#else
  return Json{{"devices", discover()}, {"adapters", Json::array()}};
#endif
}
Json configureXprinterNetwork(const Json &input) {
  const auto checked = validateXprinterNetwork(input);
  require(getOr<bool>(input, "confirmed", false),
          "Şəbəkə dəyişikliyini təsdiqləyin");
  std::lock_guard lock(operationMutex);
  bool present = false;
  for (const auto &d : discover())
    if (d["mac"] == checked["mac"] && d["ip"] == checked["oldIp"])
      present = true;
  require(present, "Printer dəyişib və ya tapılmadı. Yenidən axtarın.");
#ifdef _WIN32
  require(checked["ip"] == checked["oldIp"] || !answersPing(checked["ip"]),
          "Bu IP artıq şəbəkədə başqa cihazdadır. Başqa IP seçin.");
#endif
  sendSave(checked);
  // The printer restarts its network stack after the change; a real Ethernet
  // Xprinter on 2026-10-30 reported the new settings only after the first 2 s read-back.
  bool verified = false;
  for (int attempt = 0; attempt < 5 && !verified; ++attempt) {
    std::this_thread::sleep_for(std::chrono::seconds(2));
    try {
      for (const auto &d : discover())
        if (d["mac"] == checked["mac"] && d["ip"] == checked["ip"] &&
            d["mask"] == checked["mask"] && d["gateway"] == checked["gateway"] &&
            !d.value("dhcp", true))
          verified = true;
    } catch (...) { /* A sent command is not proof that the device applied it. */
    }
  }
  return Json{{"sent", true}, {"verified", verified}, {"settings", checked}};
}
} // namespace pos::printing
