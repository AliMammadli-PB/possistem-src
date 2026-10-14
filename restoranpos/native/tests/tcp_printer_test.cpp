#include "catch_amalgamated.hpp"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>

#include <chrono>
#include <thread>
#include <vector>

#include "pos/printing/EscPos.hpp"

namespace {

/** A one-ticket network printer on 127.0.0.1; returns its port and what it received. */
struct FakePrinter {
    SOCKET listener = INVALID_SOCKET;
    int port = 0;
    std::vector<char> received;
    std::thread worker;

    explicit FakePrinter(int acceptAfterMs) {
        listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        bind(listener, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
        int len = sizeof(addr);
        getsockname(listener, reinterpret_cast<sockaddr*>(&addr), &len);
        port = ntohs(addr.sin_port);
        // Busy until acceptAfterMs: the port is closed, as on a printer still
        // finishing the previous ticket.
        worker = std::thread([this, acceptAfterMs] {
            std::this_thread::sleep_for(std::chrono::milliseconds(acceptAfterMs));
            listen(listener, 1);
            SOCKET client = accept(listener, nullptr, nullptr);
            char buf[256];
            int n = 0;
            while ((n = recv(client, buf, sizeof(buf), 0)) > 0) received.insert(received.end(), buf, buf + n);
            closesocket(client);
        });
    }
    ~FakePrinter() {
        if (worker.joinable()) worker.join();
        closesocket(listener);
    }
};

}  // namespace

TEST_CASE("tcp print waits for a printer that is briefly busy", "[printing]") {
    WSADATA wsa{};
    WSAStartup(MAKEWORD(2, 2), &wsa);
    FakePrinter printer(1200);
    const std::vector<std::uint8_t> ticket = {0x1B, 0x40, 'O', 'K', '\n'};
    std::string error;
    REQUIRE(pos::printing::sendRawTcp("127.0.0.1", printer.port, ticket, error, 5000));
    printer.worker.join();
    REQUIRE(printer.received.size() == ticket.size());
}

TEST_CASE("tcp print to an absent printer gives up within its timeout", "[printing]") {
    WSADATA wsa{};
    WSAStartup(MAKEWORD(2, 2), &wsa);
    std::string error;
    const auto started = std::chrono::steady_clock::now();
    // TEST-NET-1: routed nowhere, so a blocking connect would hang ~21 s.
    REQUIRE_FALSE(pos::printing::sendRawTcp("192.0.2.1", 9100, {0x1B, 0x40}, error, 2000));
    const auto took = std::chrono::steady_clock::now() - started;
    REQUIRE(took < std::chrono::milliseconds(3500));
    REQUIRE_FALSE(error.empty());
}
#endif
