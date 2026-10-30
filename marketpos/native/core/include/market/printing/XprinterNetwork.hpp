#pragma once
#include <nlohmann/json.hpp>

// Ethernet Xprinter IP / mask / gateway through the official ESC SDK
// (printer.sdk.dll). Ported from restoranpos/native/core/src/printing/XprinterNetwork.cpp.
namespace market::printing {
nlohmann::json validateXprinterNetwork(const nlohmann::json &input);
nlohmann::json scanXprinterNetwork();
nlohmann::json configureXprinterNetwork(const nlohmann::json &input);
} // namespace market::printing
