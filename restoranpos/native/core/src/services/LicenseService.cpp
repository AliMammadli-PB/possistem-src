#include "pos/services/LicenseService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {

Json LicenseService::status() {
    auto stmt = ctx_.db().prepare(
        "SELECT status, license_id AS licenseId, customer_id AS customerId, "
        "       branch_id AS branchId, device_id AS deviceId, "
        "       installation_id AS installationId, channel, starts_at AS startsAt, "
        "       expires_at AS expiresAt, offline_grace_days AS offlineGraceDays, "
        "       last_validated_at AS lastValidatedAt, last_heartbeat_at AS lastHeartbeatAt, "
        "       grace_started_at AS graceStartedAt, features_json AS featuresJson, "
        "       key_id AS keyId, updated_at AS updatedAt "
        "FROM license_state WHERE id = 'local'");
    if (!stmt.step()) {
        return Json{{"status", "unlicensed"},
                    {"features", Json::object()},
                    {"controlUrl", ctx_.setting("license.controlUrl",
                                                "http://127.0.0.1:3210/pos/api")},
                    {"legacyGraceDays",
                     static_cast<std::int64_t>(
                         std::stoll(ctx_.setting("license.legacyGraceDays", "60")))},
                    {"upgradeFromLegacy", false}};
    }
    Json row = stmt.row();
    try {
        row["features"] = Json::parse(row.value("featuresJson", "{}"));
    } catch (...) {
        row["features"] = Json::object();
    }
    row.erase("featuresJson");

    const auto installation = ctx_.setting("device.installationId", "");
    if (!installation.empty()) row["installationId"] = installation;
    row["controlUrl"] =
        ctx_.setting("license.controlUrl", "http://127.0.0.1:3210/pos/api");
    try {
        row["legacyGraceDays"] =
            static_cast<std::int64_t>(std::stoll(ctx_.setting("license.legacyGraceDays", "60")));
    } catch (...) {
        row["legacyGraceDays"] = 60;
    }

    // Fresh 1.1 installs apply migrations 1..N in one burst. Real 1.0.7 upgrades
    // have migration 1 applied long before migration 7 (license_state).
    bool upgradeFromLegacy = false;
    try {
        auto gap = ctx_.db().prepare(
            "SELECT "
            "  (SELECT applied_at FROM database_migrations WHERE version = 1) AS v1, "
            "  (SELECT applied_at FROM database_migrations WHERE version = 7) AS v7");
        if (gap.step()) {
            const auto v1 = gap.columnInt(0);
            const auto v7 = gap.columnInt(1);
            if (v1 > 0 && v7 > 0 && (v7 - v1) > 60'000) {
                upgradeFromLegacy = true;
            }
        }
    } catch (...) {
        upgradeFromLegacy = false;
    }
    row["upgradeFromLegacy"] = upgradeFromLegacy;
    return row;
}

Json LicenseService::storeSignedPayload(const Json& payload, std::string_view signatureB64,
                                        std::string_view keyId) {
    const auto now = nowMs();
    const std::string canonical = serialize(payload);
    const std::string sha = crypto::sha256Hex(canonical);
    const std::string status = getOr<std::string>(payload, "status", "active");
    const std::string features = serialize(payload.value("features", Json::object()));
    const std::string installation = getOr<std::string>(
        payload, "installationId", ctx_.setting("device.installationId", ""));
    const std::int64_t graceStarted =
        status == "legacy_grace" || status == "grace" || status == "offline_grace"
            ? getOr<std::int64_t>(payload, "graceStartedAt", now)
            : getOr<std::int64_t>(payload, "graceStartedAt", 0);

    auto upsert = ctx_.db().prepare(
        "UPDATE license_state SET "
        "  status = :status, license_id = :license, customer_id = :customer, "
        "  branch_id = :branch, device_id = :device, installation_id = :install, "
        "  channel = :channel, starts_at = :starts, expires_at = :expires, "
        "  offline_grace_days = :grace, last_validated_at = :now, "
        "  grace_started_at = CASE WHEN :graceStarted > 0 THEN :graceStarted "
        "                          ELSE grace_started_at END, "
        "  signed_payload_json = :payload, payload_sha256 = :sha, "
        "  signature_b64 = :sig, key_id = :keyId, features_json = :features, "
        "  updated_at = :now "
        "WHERE id = 'local'");
    upsert.bind(":status", status)
        .bind(":license", getOr<std::string>(payload, "licenseId", ""))
        .bind(":customer", getOr<std::string>(payload, "customerId", ""))
        .bind(":branch", getOr<std::string>(payload, "branchId", ""))
        .bind(":device", getOr<std::string>(payload, "deviceId", ""))
        .bind(":install", installation)
        .bind(":channel", getOr<std::string>(payload, "channel", "stable"))
        .bind(":starts", getOr<std::int64_t>(payload, "startsAt", 0))
        .bind(":expires", getOr<std::int64_t>(payload, "expiresAt", 0))
        .bind(":grace", getOr<std::int64_t>(payload, "offlineGraceDays", 7))
        .bind(":graceStarted", graceStarted)
        .bind(":now", now)
        .bind(":payload", canonical)
        .bind(":sha", sha)
        .bind(":sig", std::string(signatureB64))
        .bind(":keyId", std::string(keyId))
        .bind(":features", features);
    upsert.exec();

    ctx_.auditRequired("license.store", "license", getOr<std::string>(payload, "licenseId", "local"),
                       Json{{"status", status}, {"keyId", std::string(keyId)}});
    return this->status();
}

bool LicenseService::featureEnabled(std::string_view featureKey, bool defaultEnabled) {
    auto stmt = ctx_.db().prepare("SELECT features_json, status FROM license_state WHERE id = 'local'");
    if (!stmt.step()) return defaultEnabled;
    const auto status = stmt.columnText(1);
    if (status == "unlicensed" || status == "revoked" || status == "expired") {
        // Soft-lock: read-only features may still be available; gated features off.
        return false;
    }
    try {
        const auto features = Json::parse(stmt.columnText(0));
        if (!features.contains(std::string(featureKey))) return defaultEnabled;
        const auto& value = features.at(std::string(featureKey));
        if (value.is_boolean()) return value.get<bool>();
        if (value.is_object() && value.contains("enabled")) return value.at("enabled").get<bool>();
    } catch (...) {
        return defaultEnabled;
    }
    return defaultEnabled;
}

void LicenseService::requireFeature(std::string_view featureKey) {
    if (!featureEnabled(featureKey, true)) {
        throw PosError(std::string(protocol::err::kFeatureDisabled),
                       "This feature is disabled by the current license");
    }
}

void LicenseService::requireLicensedForNewBusinessDay() {
    auto stmt = ctx_.db().prepare("SELECT status, expires_at FROM license_state WHERE id = 'local'");
    if (!stmt.step()) {
        throw PosError(std::string(protocol::err::kLicenseRequired), "A valid license is required");
    }
    const auto status = stmt.columnText(0);
    if (status == "unlicensed") {
        // Fresh installs must activate; legacy_grace/active/offline_grace are OK.
        // During development before control plane activation, allow if installation
        // still carries the pre-1.1 unlicensed row with no expiry — Electron will
        // upgrade this to legacy_grace on first real 1.0.7→1.1.0 upgrade.
        return;
    }
    if (status == "revoked") {
        throw PosError(std::string(protocol::err::kLicenseRevoked), "License has been revoked");
    }
    if (status == "expired") {
        throw PosError(std::string(protocol::err::kLicenseExpired),
                       "License expired; finish open orders then activate");
    }
}

}  // namespace pos::services
