-- Unique on key for Drizzle onConflictDoUpdate({ target: featureFlags.key })
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_key_uidx ON feature_flags(key);
