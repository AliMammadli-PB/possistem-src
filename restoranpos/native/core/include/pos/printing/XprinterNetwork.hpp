#pragma once
#include "pos/Common.hpp"
namespace pos::printing {
Json validateXprinterNetwork(const Json &input);
bool xprinterSdkAvailable();
Json scanXprinterNetwork();
Json configureXprinterNetwork(const Json &input);
} // namespace pos::printing
