#include "catch_amalgamated.hpp"

#include <algorithm>

#include "pos/printing/DeviceDiscovery.hpp"
#include "pos/printing/EscPos.hpp"

using pos::printing::PrinterCandidate;
using pos::printing::PrinterLink;

namespace {

PrinterCandidate make(PrinterLink link, const std::string& name, const std::string& driver = "",
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

TEST_CASE("USB device paths yield vendor and product ids", "[printer][usb]") {
    std::string vid;
    std::string pid;

    REQUIRE(pos::printing::parseUsbIds(
        R"(\\?\usb#vid_0483&pid_5743#6&1a2b3c4d&0&2#{28d78fad-5a12-11d1-ae5b-0000f803a8c2})", vid,
        pid));
    REQUIRE(vid == "0483");
    REQUIRE(pid == "5743");

    // Windows hands the path back in mixed case depending on the API used.
    REQUIRE(pos::printing::parseUsbIds(R"(\\?\USB#VID_04B8&PID_0E15#ABC)", vid, pid));
    REQUIRE(vid == "04b8");
    REQUIRE(pid == "0e15");

    REQUIRE_FALSE(pos::printing::parseUsbIds(R"(\\?\usb#nothing-here)", vid, pid));
    REQUIRE(vid.empty());
    REQUIRE(pid.empty());
}

TEST_CASE("IEEE-1284 identity strings split into manufacturer and model", "[printer][usb]") {
    const auto parsed = pos::printing::parseDeviceId("MFG:Xprinter;MDL:XP-58;CMD:ESC/POS;");
    REQUIRE(parsed.manufacturer == "Xprinter");
    REQUIRE(parsed.model == "XP-58");
    REQUIRE(parsed.commandSet == "ESC/POS");

    // Long-form keys and padding are both in the wild.
    const auto verbose =
        pos::printing::parseDeviceId("MANUFACTURER: EPSON ;MODEL: TM-T20III ;COMMANDSET:ESCPOS");
    REQUIRE(verbose.manufacturer == "EPSON");
    REQUIRE(verbose.model == "TM-T20III");
    REQUIRE(verbose.commandSet == "ESCPOS");

    const auto empty = pos::printing::parseDeviceId("");
    REQUIRE(empty.manufacturer.empty());
    REQUIRE(empty.model.empty());
}

TEST_CASE("candidate ranking prefers a directly writable thermal printer",
          "[printer][usb][ranking]") {
    const auto rawThermal = make(PrinterLink::UsbRaw, "XP-58", "", "XP-58");
    const auto queueThermal = make(PrinterLink::UsbQueue, "KASSA", "POS58 Printer");
    const auto serialPort = make(PrinterLink::Serial, "COM3");
    const auto office = make(PrinterLink::UsbQueue, "HP LaserJet M404", "HP LaserJet");
    const auto virtualTarget = make(PrinterLink::Virtual, "virtual");

    REQUIRE(rawThermal.score > queueThermal.score);
    REQUIRE(queueThermal.score > serialPort.score);
    REQUIRE(serialPort.score > virtualTarget.score);

    // A non-positive score is the rule auto-selection uses to skip a device, so
    // an A4 laser can be listed for manual choice but never picked for the till.
    REQUIRE(office.score <= 0);
    REQUIRE(virtualTarget.score <= 0);
    REQUIRE(office.score < serialPort.score);
    REQUIRE(office.score < queueThermal.score);
}

TEST_CASE("software print queues are never offered as printers", "[printer][ranking]") {
    REQUIRE(pos::printing::isSoftwarePrinter("Microsoft Print to PDF", "PORTPROMPT:"));
    REQUIRE(pos::printing::isSoftwarePrinter("OneNote (Desktop)", "nul:"));
    REQUIRE(pos::printing::isSoftwarePrinter("Fax", "SHRFAX:"));
    REQUIRE(pos::printing::isSoftwarePrinter("Microsoft XPS Document Writer", "XPSPort:"));

    REQUIRE_FALSE(pos::printing::isSoftwarePrinter("KASSA", "USB001"));
    REQUIRE_FALSE(pos::printing::isSoftwarePrinter("XP-58", "USB002"));
}

TEST_CASE("printer targets route to the right transport", "[printer][target]") {
    std::string devicePath;
    REQUIRE(pos::printing::parseUsbRawPrinter(R"(usbraw:\\?\usb#vid_0483&pid_5743#x)", devicePath));
    REQUIRE(devicePath == R"(\\?\usb#vid_0483&pid_5743#x)");
    REQUIRE_FALSE(pos::printing::parseUsbRawPrinter("win:KASSA", devicePath));
    REQUIRE_FALSE(pos::printing::parseUsbRawPrinter("usbraw:", devicePath));

    std::string port;
    int baud = 0;
    REQUIRE(pos::printing::parseSerialPrinter("serial:COM3", port, baud));
    REQUIRE(port == "COM3");
    REQUIRE(baud == 9600);
    REQUIRE(pos::printing::parseSerialPrinter("serial:COM12@19200", port, baud));
    REQUIRE(port == "COM12");
    REQUIRE(baud == 19200);
    REQUIRE_FALSE(pos::printing::parseSerialPrinter("tcp:10.0.0.5:9100", port, baud));

    // The direct-device schemes must not be mistaken for a network address or a
    // spooler queue name, or the bytes go to the wrong place entirely.
    std::string host;
    int tcpPort = 0;
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("usbraw:\\\\?\\usb#x", host, tcpPort));
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("serial:COM3", host, tcpPort));
    REQUIRE_FALSE(pos::printing::parseNetworkPrinter("auto", host, tcpPort));
    REQUIRE(pos::printing::parseNetworkPrinter("tcp:192.168.1.200:9100", host, tcpPort));
    REQUIRE(host == "192.168.1.200");
    REQUIRE(tcpPort == 9100);

    std::string windowsName;
    REQUIRE_FALSE(pos::printing::parseWindowsPrinter("usbraw:\\\\?\\usb#x", windowsName));
    REQUIRE_FALSE(pos::printing::parseWindowsPrinter("serial:COM3", windowsName));
    REQUIRE_FALSE(pos::printing::parseWindowsPrinter("auto", windowsName));
    REQUIRE(pos::printing::parseWindowsPrinter("win:KASSA", windowsName));
    REQUIRE(windowsName == "KASSA");
}
