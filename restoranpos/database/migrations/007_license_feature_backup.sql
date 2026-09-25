-- ============================================================================
-- 007 - License cache, feature flags, device identity, backup manifests
-- ============================================================================

CREATE TABLE license_state (
    id                    TEXT PRIMARY KEY CHECK (id = 'local'),
    status                TEXT NOT NULL DEFAULT 'unlicensed'
                          CHECK (status IN ('unlicensed','active','grace','legacy_grace',
                                            'expired','revoked','offline_grace')),
    license_id            TEXT NOT NULL DEFAULT '',
    customer_id           TEXT NOT NULL DEFAULT '',
    branch_id             TEXT NOT NULL DEFAULT '',
    device_id             TEXT NOT NULL DEFAULT '',
    installation_id       TEXT NOT NULL DEFAULT '',
    channel               TEXT NOT NULL DEFAULT 'stable',
    starts_at             INTEGER,
    expires_at            INTEGER,
    offline_grace_days    INTEGER NOT NULL DEFAULT 7,
    last_validated_at     INTEGER,
    last_heartbeat_at     INTEGER,
    grace_started_at      INTEGER,
    clock_rollback_seen   INTEGER NOT NULL DEFAULT 0 CHECK (clock_rollback_seen IN (0,1)),
    signed_payload_json   TEXT NOT NULL DEFAULT '{}',
    payload_sha256        TEXT NOT NULL DEFAULT '',
    signature_b64         TEXT NOT NULL DEFAULT '',
    key_id                TEXT NOT NULL DEFAULT '',
    features_json         TEXT NOT NULL DEFAULT '{}',
    updated_at            INTEGER NOT NULL
);

INSERT INTO license_state (id, status, updated_at)
VALUES ('local', 'unlicensed', CAST(strftime('%s','now') AS INTEGER) * 1000);

CREATE TABLE feature_flags_cache (
    key         TEXT PRIMARY KEY,
    enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    value_json  TEXT NOT NULL DEFAULT 'true',
    updated_at  INTEGER NOT NULL
);

CREATE TABLE backup_manifests (
    id              TEXT PRIMARY KEY,
    path            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('manual','pre_migration','pre_restore','scheduled')),
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    content_sha256  TEXT NOT NULL DEFAULT '',
    includes_json   TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    note            TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_backup_manifests_created ON backup_manifests(created_at);

-- Unique installation identity (human terminal name stays in app_settings).
INSERT INTO app_settings (key, value, value_type, updated_at)
SELECT 'device.installationId', lower(hex(randomblob(16))), 'string',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'device.installationId');

INSERT INTO app_settings (key, value, value_type, updated_at)
SELECT 'license.controlUrl', 'https://possistem.az/pos/api', 'string',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'license.controlUrl');

INSERT INTO app_settings (key, value, value_type, updated_at)
SELECT 'license.legacyGraceDays', '60', 'int',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'license.legacyGraceDays');
