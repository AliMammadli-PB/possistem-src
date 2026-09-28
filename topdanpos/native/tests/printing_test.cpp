#include "catch_amalgamated.hpp"
#include "market/printing/DeviceDiscovery.hpp"
#include "market/printing/RawSend.hpp"

#include <string>

/**
 * The printing port.
 *
 * DeviceDiscovery and the four raw transports are copied from the restaurant
 * core by scripts/port-printing-from-restaurant.mjs, which rewrites the
 * namespace and the logger handle. These cases exist because that copy is
 * mechanical: they check that the logic arrived intact and still answers the
 * questions the till asks of it, so a port that silently truncated a file or
 * dropped a function fails here rather than on a counter in Gəncə.
 *
 * Everything here is a pure function of strings. Nothing plugs in a printer.
 */

using namespace market::printing;

TEST_CASE("target strings dispatch to the transport their shape names", "[printing][port]") {
    // sendOnce picks a transport by parsing the target. If the parsers came
    // across wrong, a receipt goes to the wrong subsystem - or to none.
    std::string host;
    int port = 0;
    REQUIRE(parseNetworkPrinter("tcp:192.168.1.50:9100", host, port));
    CHECK(host == "192.168.1.50");
    CHECK(port == 9100);

    std::string devicePath;
    REQUIRE(parseUsbRawPrinter("usbraw:\\\\?\\usb#vid_0483&pid_5743#5&1f", devicePath));
    CHECK(devicePath == "\\\\?\\usb#vid_0483&pid_5743#5&1f");

    std::string serialPort;
    int baud = 0;
    REQUIRE(parseSerialPrinter("serial:COM3@19200", serialPort, baud));
    CHECK(serialPort == "COM3");
    CHECK(baud == 19200);

    // A plain name is a Windows queue: the shape with no marker is the
    // fallback, which is why it is tried last.
    std::string queue;
    REQUIRE(parseWindowsPrinter("XP-58", queue));
    CHECK(queue == "XP-58");

    // And an unknown target fails with a message rather than printing nowhere.
    std::string error;
    CHECK_FALSE(sendOnce("", {0x1B, 0x40}, error));
    CHECK_FALSE(error.empty());
}

TEST_CASE("ESC/POS status bytes are told apart from any other reply", "[printing][port]") {
    // The fixed bits are what keep a LAN sweep from adopting a router's open
    // port as the till's printer.
    CHECK(isEscPosStatusByte(0x12));
    CHECK(isEscPosStatusByte(0x1A));
    CHECK_FALSE(isEscPosStatusByte(0x00));
    CHECK_FALSE(isEscPosStatusByte(0xFF));

    CHECK(decodeEscPosStatus(0x12).online);
    // Bit 3 is the offline flag: a printer that answers is not a printer that
    // is ready, and detection has to tell the two apart.
    const auto offline = decodeEscPosStatus(0x1A);
    CHECK(offline.valid);
    CHECK_FALSE(offline.online);
}

TEST_CASE("IEEE-1284 identity is parsed into a name the operator recognises",
          "[printing][port]") {
    const auto id = parseDeviceId("MFG:Xprinter;MDL:XP-58;CMD:ESC/POS;");
    CHECK(id.manufacturer == "Xprinter");
    CHECK(id.model == "XP-58");
    CHECK(id.commandSet == "ESC/POS");

    std::string vendorId;
    std::string productId;
    REQUIRE(parseUsbIds("\\\\?\\usb#vid_0483&pid_5743#5&1f", vendorId, productId));
    CHECK(vendorId == "0483");
    CHECK(productId == "5743");
}

TEST_CASE("a PDF queue under a shop's own brand is not a printer", "[printing][port]") {
    // The failure this prevents: the spooler accepts raw ESC/POS for such a
    // queue and reports success, so the receipt is swallowed silently.
    CHECK(isSoftwarePrinter("PanCafe Printer", "C:\\out\\job.pdf", "Microsoft Print To PDF"));
    CHECK(isSoftwarePrinter("Microsoft XPS Document Writer", "PORTPROMPT:", ""));
    CHECK_FALSE(isSoftwarePrinter("XP-58", "USB001", "Generic / Text Only"));
}

TEST_CASE("a confirmed thermal printer outranks anything that proves nothing",
          "[printing][port]") {
    PrinterCandidate thermal;
    thermal.target = "tcp:192.168.1.50:9100";
    thermal.link = PrinterLink::Network;
    thermal.model = "XP-80C";
    thermal.escposConfirmed = true;

    PrinterCandidate office;
    office.target = "HP LaserJet 1020";
    office.link = PrinterLink::UsbQueue;
    office.model = "HP LaserJet 1020";
    office.driver = "HP LaserJet 1020";

    CHECK(scoreCandidate(thermal) > scoreCandidate(office));
    // An A4 laser must not merely rank lower - detection skips candidates at or
    // below zero, so the till never tries to print a receipt on one.
    CHECK(scoreCandidate(office) <= 0);
}

TEST_CASE("a subnet sweep stays bounded", "[printing][port]") {
    // Without the ceiling a misconfigured /8 turns one receipt into a
    // sixteen-million-socket sweep.
    const auto small = subnetHosts(ipv4ToUint("192.168.1.0"), 24);
    CHECK(small.size() == 254);
    CHECK(small.front() == "192.168.1.1");
    CHECK(small.back() == "192.168.1.254");
    CHECK(subnetHosts(ipv4ToUint("10.0.0.0"), 8).empty());

    CHECK(uintToIpv4(ipv4ToUint("172.16.31.9")) == "172.16.31.9");
    CHECK(ipv4ToUint("not-an-address") == 0);
}
