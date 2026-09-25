#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Local license cache + feature enforcement.
 *
 * Signature verification and control-plane HTTP live in Electron main; the core
 * stores the last valid signed payload and decides whether mutations are allowed.
 */
class LicenseService {
public:
    explicit LicenseService(handlers::Context& ctx) : ctx_(ctx) {}

    Json status();
    Json storeSignedPayload(const Json& payload, std::string_view signatureB64,
                            std::string_view keyId);
    bool featureEnabled(std::string_view featureKey, bool defaultEnabled = true);
    void requireFeature(std::string_view featureKey);
    void requireLicensedForNewBusinessDay();

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
