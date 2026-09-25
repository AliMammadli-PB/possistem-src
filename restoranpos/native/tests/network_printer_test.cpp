#include "catch_amalgamated.hpp"

#include <algorithm>

#include "pos/printing/DeviceDiscovery.hpp"
#include "pos/printing/EscPos.hpp"

using pos::printing::PrinterCandidate;
using pos::printing::PrinterLink;

namespace {

PrinterCandidate network(const std::string& ip, bool confirmed, std::uint8_t status,
                         const std::string& model = "") {
    PrinterCandidate candidate;
    candidate.link = PrinterLink::Network;
    candidate.target = "tcp:" + ip + ":9100";
    candidate.ipAddress = ip;
    candidate.model = model;
    candidate.escposConfirmed = confirmed;
    candidate.statusByte = status;
    if (confirmed) candidate.commandSet = "ESC/POS";
    candidate.score = pos::printing::scoreCandidate(candidate);
    return candidate;
}

PrinterCandidate local(PrinterLink link, const std::string& name, const std::string& driver = "",
                       const std::string& model = "") {
    PrinterCandidate candidate;
    candidate.link = link;
    candidate.displayName = name;
    candidate.driver = driver;
    candidate.model = model;
    candidate.target = name;
    candidate.score = pos::printing::scoreCandidate(candidate);
    return candidate;
}

}  // namespace

TEST_CASE("ESC/POS status bytes are recognised by their fixed bits", "[printer][network]") {
    // The real reply from the till printer at 192.168.1.198.
    REQUIRE(pos::printing::isEscPosStatusByte(0x16));
    // Minimum legal pattern: only the fixed bits set.
    REQUIRE(pos::printing::isEscPosStatusByte(0x12));

    // Anything without the fixed pattern is not a printer answering.
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0x00));
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0xFF));
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0x02));  // bit4 clear
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0x10));  // bit1 clear
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0x13));  // bit0 set
    REQUIRE_FALSE(pos::printing::isEscPosStatusByte(0x92));  // bit7 set
}

TEST_CASE("ESC/POS status decodes to operator-visible flags", "[printer][network]") {
    const auto online = pos::printing::decodeEscPosStatus(0x16);
    REQUIRE(online.valid);
    REQUIRE(online.answered);
    REQUIRE(online.online);
    REQUIRE(online.drawerHigh);
    REQUIRE_FALSE(online.waitingRecovery);

    // Bit 3 set means the printer is offline - cover open, out of paper, etc.
    const auto offline = pos::printing::decodeEscPosStatus(0x1E);
    REQUIRE(offline.valid);
    REQUIRE_FALSE(offline.online);

    const auto nonsense = pos::printing::decodeEscPosStatus(0xAB);
    REQUIRE_FALSE(nonsense.valid);
    REQUIRE_FALSE(nonsense.answered);
}

TEST_CASE("IPv4 text round-trips through the scan helpers", "[printer][network]") {
    REQUIRE(pos::printing::ipv4ToUint("192.168.1.198") == 0xC0A801C6u);
    REQUIRE(pos::printing::ipv4ToUint("0.0.0.1") == 1u);
    REQUIRE(pos::printing::uintToIpv4(0xC0A801C6u) == "192.168.1.198");

    // Rejected: out of range, wrong shape, not an address at all.
    REQUIRE(pos::printing::ipv4ToUint("192.168.1.256") == 0u);
    REQUIRE(pos::printing::ipv4ToUint("192.168.1") == 0u);
    REQUIRE(pos::printing::ipv4ToUint("192.168.1.1.1") == 0u);
    REQUIRE(pos::printing::ipv4ToUint("printer.local") == 0u);
    REQUIRE(pos::printing::ipv4ToUint("") == 0u);
}

TEST_CASE("Subnet expansion skips network and broadcast and is bounded", "[printer][network]") {
    const auto slash24 = pos::printing::subnetHosts(pos::printing::ipv4ToUint("192.168.1.125"), 24);
    REQUIRE(slash24.size() == 254);
    REQUIRE(slash24.front() == "192.168.1.1");
    REQUIRE(slash24.back() == "192.168.1.254");
    REQUIRE(std::find(slash24.begin(), slash24.end(), "192.168.1.198") != slash24.end());
    REQUIRE(std::find(slash24.begin(), slash24.end(), "192.168.1.0") == slash24.end());
    REQUIRE(std::find(slash24.begin(), slash24.end(), "192.168.1.255") == slash24.end());

    const auto slash30 = pos::printing::subnetHosts(pos::printing::ipv4ToUint("10.0.0.5"), 30);
    REQUIRE(slash30.size() == 2);
    REQUIRE(slash30.front() == "10.0.0.5");

    // A /16 is 65k hosts: refused outright so a print can never turn into one.
    REQUIRE(pos::printing::subnetHosts(pos::printing::ipv4ToUint("172.16.5.5"), 16).empty());
    REQUIRE(pos::printing::subnetHosts(pos::printing::ipv4ToUint("10.0.0.1"), 8).empty());
}

TEST_CASE("Known targets lead the scan order", "[printer][network]") {
    pos::printing::NetworkScanOptions options;
    options.sweepSubnet = false;  // seeds only, so the assertion holds on any host
    options.knownTargets = {"tcp:192.168.1.198:9100"};

    const auto hosts = pos::printing::buildScanHostList(options);
    REQUIRE_FALSE(hosts.empty());
    REQUIRE(hosts.front() == "192.168.1.198");

    // The same address must not be probed twice however it was seeded.
    REQUIRE(std::count(hosts.begin(), hosts.end(), "192.168.1.198") == 1);
}

TEST_CASE("Branded PDF queues are rejected as software printers", "[printer][network]") {
    // The queue that silently swallowed every receipt on the till: an internet
    // café tool's own brand name, on the Print To PDF driver, aimed at a file.
    REQUIRE(pos::printing::isSoftwarePrinter(
        "PanCafe Printer", R"(C:\Program Files (x86)\Pan Group\PanCafe Pro Client\PrintTemp\000.pdf)",
        "Microsoft Print To PDF"));

    // Driver alone is enough, whatever the queue is called.
    REQUIRE(pos::printing::isSoftwarePrinter("Kasa", "USB001", "Microsoft XPS Document Writer"));
    // A file-path port is enough even with an innocent driver.
    REQUIRE(pos::printing::isSoftwarePrinter("Spool", R"(C:\temp\out.prn)", "Generic / Text Only"));
    REQUIRE(pos::printing::isSoftwarePrinter("Prompt", "PORTPROMPT:", ""));

    // A real thermal printer must still pass.
    REQUIRE_FALSE(pos::printing::isSoftwarePrinter("XP-80C", "USB001", "Generic / Text Only"));
    REQUIRE_FALSE(pos::printing::isSoftwarePrinter("Kassa", "IP_192.168.1.198", "POS Printer"));
}

TEST_CASE("A confirmed network printer outranks local links that prove nothing",
          "[printer][network]") {
    const auto confirmed = network("192.168.1.198", true, 0x16);
    const auto silent = network("192.168.1.50", false, 0x00);
    const auto offline = network("192.168.1.51", true, 0x1E);

    const auto serial = local(PrinterLink::Serial, "serial:COM3");
    const auto anonymousQueue = local(PrinterLink::Other, "Some Queue");
    const auto usbThermal = local(PrinterLink::UsbRaw, "XP-58", "Generic / Text Only", "XP-58");

    // The whole point of the fix: the printer on the switch beats every local
    // link that cannot prove it is a printer, so `auto` reaches it.
    REQUIRE(confirmed.score > serial.score);
    REQUIRE(confirmed.score > silent.score);
    REQUIRE(confirmed.score > offline.score);
    REQUIRE(confirmed.score > anonymousQueue.score);

    // A USB printer-class device still wins: it is certainly a printer and
    // certainly this till's, while a LAN box may belong to the kitchen.
    REQUIRE(usbThermal.score > confirmed.score);

    // Confirmation must be paid for once, not once as a bonus and again as a
    // keyword hit on text the sweep itself synthesised from the same reply.
    REQUIRE(confirmed.score == 90);

    // The sweep labels what it finds "ESC/POS printer <ip>" and sets the command
    // set to ESC/POS. Neither may feed the keyword scan: with both counted the
    // score reached 127 and beat a USB thermal printer.
    PrinterCandidate labelled = confirmed;
    labelled.displayName = "ESC/POS printer 192.168.1.198";
    labelled.commandSet = "ESC/POS";
    REQUIRE(pos::printing::scoreCandidate(labelled) == 90);

    // Real model evidence still counts - an SNMP or mDNS model name is not
    // something the sweep made up.
    PrinterCandidate identified = confirmed;
    identified.model = "XP-80C";
    REQUIRE(pos::printing::scoreCandidate(identified) == 102);

    // An unrecognised spooler queue is no longer eligible at all.
    REQUIRE(anonymousQueue.score <= 0);

    // An offline printer stays listed for the settings screen but cannot win.
    REQUIRE(offline.score < confirmed.score);
}

/**
 * Live sweep against whatever is actually on this machine's LAN.
 *
 * Hidden (the leading `.` in the tag) so it never runs in a normal `ctest`:
 * the result depends on the room the till is standing in. Run it by hand on a
 * new site to confirm the receipt printer is discoverable before handing over:
 *
 *   core_tests.exe "[live]" --reporter console -s
 */
TEST_CASE("live: the LAN sweep finds this site's receipt printer", "[.][live][printer][network]") {
    pos::printing::NetworkScanOptions options;
    const auto found = pos::printing::discoverNetworkPrinters(options);

    WARN("network printers found: " << found.size());
    for (const auto& candidate : found) {
        WARN(candidate.target << "  escpos=" << candidate.escposConfirmed
                              << "  status=0x" << std::hex << int(candidate.statusByte) << std::dec
                              << "  mac=" << candidate.macAddress << "  score=" << candidate.score);
    }

    // A site with no network printer is a legitimate configuration, so this only
    // asserts that anything discovered is coherent.
    for (const auto& candidate : found) {
        REQUIRE(candidate.link == PrinterLink::Network);
        REQUIRE(candidate.target.rfind("tcp:", 0) == 0);
        REQUIRE_FALSE(candidate.ipAddress.empty());
        if (candidate.escposConfirmed) {
            REQUIRE(pos::printing::isEscPosStatusByte(candidate.statusByte));
            REQUIRE(candidate.score >= 90);
        }
    }
}

TEST_CASE("Network printer targets parse back into host and port", "[printer][network]") {
    std::string host;
    int port = 0;

    REQUIRE(pos::printing::parseNetworkPrinter("tcp:192.168.1.198:9100", host, port));
    REQUIRE(host == "192.168.1.198");
    REQUIRE(port == 9100);

    // Bare IPv4 means the JetDirect default.
    REQUIRE(pos::printing::parseNetworkPrinter("192.168.1.198", host, port));
    REQUIRE(host == "192.168.1.198");
    REQUIRE(port == 9100);

    // Multi-port print server boxes.
    REQUIRE(pos::printing::parseNetworkPrinter("tcp:192.168.1.198:9101", host, port));
    REQUIRE(port == 9101);

    // Sentinels and local links are not network targets.
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("auto", host, port));
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("virtual", host, port));
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("usbraw:\\\\?\\usb#vid_0483", host, port));
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("win:PanCafe Printer", host, port));
}
