#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pos::printing {

/**
 * How a printer is physically attached, in the order we prefer to reach it.
 *
 * `UsbRaw` is first on purpose: the inbox `usbprint.sys` driver binds to every
 * USB printer-class device, so a raw device-path write reaches a till printer
 * that Windows never got a vendor driver for - which is the normal state of a
 * cheap thermal printer someone just plugged in.
 */
enum class PrinterLink {
    UsbRaw,
    UsbQueue,
    Serial,
    Lpt,
    Network,
    Other,
    Virtual,
};

std::string_view linkToString(PrinterLink link);

/** One reachable printing destination, ready to be written to. */
struct PrinterCandidate {
    /** Target string the print pipeline understands, e.g. `usbraw:\\?\usb#...`. */
    std::string target;
    /** What the operator should see in the settings list. */
    std::string displayName;
    PrinterLink link = PrinterLink::Other;
    /** Manufacturer/model from the IEEE-1284 device ID, when the device answers. */
    std::string manufacturer;
    std::string model;
    std::string commandSet;
    /** USB ids in lower-case hex, empty for non-USB links. */
    std::string vendorId;
    std::string productId;
    /** Windows port (`USB001`) and driver name, for spooler queues. */
    std::string port;
    std::string driver;
    /** IPv4 address and MAC, for `Network` links. MAC comes from the ARP cache. */
    std::string ipAddress;
    std::string macAddress;
    /**
     * True when the device answered `DLE EOT 1` with a well-formed status byte.
     *
     * This is the difference between "port 9100 is open" and "there is an ESC/POS
     * printer here": an SSH daemon or a web server also accepts a connection, but
     * only a printer replies with the fixed bit pattern.
     */
    bool escposConfirmed = false;
    /** The raw `DLE EOT 1` reply, 0 when the device did not answer. */
    std::uint8_t statusByte = 0;
    /** Higher is more likely to be the till's receipt printer. */
    int score = 0;
    /** True when this is the target currently stored in `printer.receipt`. */
    bool isCurrent = false;
};

/** Decoded `DLE EOT 1` real-time status reply. */
struct EscPosStatus {
    bool answered = false;
    std::uint8_t raw = 0;
    /** Fixed-bit check passed, i.e. this really is a status byte. */
    bool valid = false;
    bool online = false;
    bool waitingRecovery = false;
    bool feedButton = false;
    bool drawerHigh = false;
};

/**
 * True when `raw` carries the fixed bits of a `DLE EOT 1` reply.
 *
 * Bits 0, 1, 4 and 7 are hardwired by the ESC/POS spec to 0, 1, 1, 0. Masking
 * with 0x93 and requiring 0x12 rejects everything that is not a printer, which
 * is what keeps a LAN sweep from adopting a router's telnet port as the till's
 * receipt printer.
 */
bool isEscPosStatusByte(std::uint8_t raw);

/** Splits a `DLE EOT 1` reply into its flags. `valid` is false for non-replies. */
EscPosStatus decodeEscPosStatus(std::uint8_t raw);

/** `MFG:Xprinter;MDL:XP-58;CMD:ESC/POS;` → manufacturer / model / command set. */
struct DeviceId {
    std::string manufacturer;
    std::string model;
    std::string commandSet;
};
DeviceId parseDeviceId(std::string_view ieee1284);

/** Pulls `vid_0483` / `pid_5743` out of a USB device interface path. */
bool parseUsbIds(std::string_view devicePath, std::string& vendorId, std::string& productId);

/**
 * Ranks a destination by how much it looks like a thermal receipt printer.
 *
 * Scoring is a pure function of the strings so it can be unit tested without a
 * device: link kind sets the base, model/driver keywords add, and office
 * printer keywords subtract hard enough to push an A4 laser below `virtual`.
 */
int scoreCandidate(const PrinterCandidate& candidate);

/**
 * True for destinations that are a software queue rather than a printer.
 *
 * The driver name and a file-path port both have to be inspected: an internet
 * café or PDF tool installs a queue under its own brand ("PanCafe Printer") on
 * the `Microsoft Print To PDF` driver pointed at a `.pdf` file. The spooler
 * accepts RAW ESC/POS for such a queue and reports success, so a receipt is
 * silently swallowed - the exact failure this check exists to prevent.
 */
bool isSoftwarePrinter(std::string_view name, std::string_view port,
                       std::string_view driver = {});

// ------------------------------------------------------------ network scan --

/** IPv4 dotted-quad → host-order integer. Returns 0 when the text is not an IPv4. */
std::uint32_t ipv4ToUint(std::string_view dotted);

/** Host-order integer → dotted quad. */
std::string uintToIpv4(std::uint32_t value);

/**
 * The usable hosts of a subnet, network and broadcast excluded.
 *
 * Returns empty above `maxHosts` so a misconfigured /8 can never turn a print
 * into a sixteen-million-socket sweep.
 */
std::vector<std::string> subnetHosts(std::uint32_t address, int prefixLength,
                                     std::size_t maxHosts = 4096);

struct NetworkScanOptions {
    /** Tried before anything else, e.g. the currently configured `tcp:` target. */
    std::vector<std::string> knownTargets;
    /** Raw-print ports. 9101/9102 exist on multi-port print server boxes. */
    std::vector<int> ports{9100, 9101, 9102};
    int connectTimeoutMs = 400;
    int statusTimeoutMs = 600;
    int maxConcurrent = 256;
    /** Hard ceiling for the whole sweep, so a print never hangs behind a scan. */
    int budgetMs = 6000;
    /** False probes only the seeds - the cheap re-verify done before each job. */
    bool sweepSubnet = true;
};

/** Local IPv4 subnets worth sweeping: no loopback, APIPA or virtual adapters. */
std::vector<std::pair<std::uint32_t, int>> localScanSubnets();

/** Addresses currently in the ARP/neighbour cache, i.e. hosts that have spoken. */
std::vector<std::string> arpCacheHosts();

/** MAC for an IPv4 address from the ARP cache, empty when it is not cached. */
std::string macForAddress(std::string_view ipAddress);

/** Hosts configured on Windows Standard TCP/IP printer ports. */
std::vector<std::string> printerPortHosts();

/**
 * The hosts to probe, best-first: known targets, then the ARP cache, then
 * configured printer ports and gateways, then the rest of the local subnets.
 *
 * Ordering is the whole trick: the till's printer has almost always exchanged
 * traffic recently, so it surfaces from the ARP cache in the first few entries
 * and the sweep tail is never reached.
 */
std::vector<std::string> buildScanHostList(const NetworkScanOptions& options);

/** Every reachable raw-print endpoint, identified and scored. */
std::vector<PrinterCandidate> discoverNetworkPrinters(const NetworkScanOptions& options);

/** Every USB printer-class device currently attached (Windows only). */
std::vector<PrinterCandidate> discoverUsbPrinters();

/** Every serial port that could have a printer on it (Windows only). */
std::vector<PrinterCandidate> discoverSerialPorts();

/** Every spooler queue, minus the software ones (Windows only). */
std::vector<PrinterCandidate> discoverSpoolerQueues();

/**
 * The full candidate list, de-duplicated and sorted best-first.
 *
 * `currentTarget` is marked and kept in the list even when it is not currently
 * attached, so the settings screen can still show what is configured.
 *
 * `includeNetwork` runs the LAN sweep as well. It is on by default because a
 * till whose printer sits on the switch is otherwise undiscoverable, and off
 * only where the caller already knows it wants local links exclusively.
 */
std::vector<PrinterCandidate> rankPrinterCandidates(const std::string& currentTarget,
                                                    bool includeNetwork = true);

}  // namespace pos::printing
