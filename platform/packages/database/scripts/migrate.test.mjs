import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../../migrations');

describe('@milioner/database migrations', () => {
  it('ships ordered SQL migrations including customer portal state', () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    assert.ok(files.includes('0001_init.sql'));
    assert.ok(files.includes('0002_feature_flags_key_unique.sql'));
    assert.ok(files.includes('0010_contact_leads.sql'));
    assert.ok(files.includes('0011_customer_portal.sql'));
    assert.ok(files.includes('0012_device_heartbeat_auth.sql'));
    assert.ok(files.includes('0014_gamecenter_pcs.sql'));
    assert.ok(files.includes('0015_gamecenter_wake_on_lan.sql'));
    assert.ok(files.includes('0016_gamecenter_shutdown_commands.sql'));
    assert.ok(files.includes('0017_gamecenter_agents.sql'));
    const init = readFileSync(path.join(migrationsDir, '0001_init.sql'), 'utf8');
    assert.match(init, /feature_flags/);
    assert.match(init, /key text NOT NULL UNIQUE/);
    const uidx = readFileSync(path.join(migrationsDir, '0002_feature_flags_key_unique.sql'), 'utf8');
    assert.match(uidx, /feature_flags_key_uidx/);
    const leads = readFileSync(path.join(migrationsDir, '0010_contact_leads.sql'), 'utf8');
    assert.match(leads, /CREATE TABLE IF NOT EXISTS contact_leads/);
    assert.match(leads, /CHECK \(status IN \('new', 'contacted', 'qualified', 'closed'\)\)/);
    const portal = readFileSync(path.join(migrationsDir, '0011_customer_portal.sql'), 'utf8');
    assert.match(portal, /CREATE TABLE IF NOT EXISTS customer_sessions/);
    assert.match(portal, /CREATE TABLE IF NOT EXISTS customer_password_resets/);
    assert.match(portal, /CREATE TABLE IF NOT EXISTS customer_onboarding/);
    assert.match(portal, /CREATE TABLE IF NOT EXISTS customer_support_uploads/);
    const heartbeat = readFileSync(
      path.join(migrationsDir, '0012_device_heartbeat_auth.sql'),
      'utf8',
    );
    assert.match(heartbeat, /heartbeat_auth_required/);
    const gamecenter = readFileSync(
      path.join(migrationsDir, '0014_gamecenter_pcs.sql'),
      'utf8',
    );
    assert.match(gamecenter, /CREATE TABLE IF NOT EXISTS gamecenter_pcs/);
    assert.match(gamecenter, /active smallint NOT NULL DEFAULT 0 CHECK \(active IN \(0, 1\)\)/);
    const wakeOnLan = readFileSync(
      path.join(migrationsDir, '0015_gamecenter_wake_on_lan.sql'),
      'utf8',
    );
    assert.match(wakeOnLan, /ADD COLUMN IF NOT EXISTS mac text/);
    assert.match(wakeOnLan, /CREATE TABLE IF NOT EXISTS gamecenter_pc_commands/);
    assert.match(wakeOnLan, /gamecenter_pc_commands_one_pending_idx/);
    const shutdown = readFileSync(
      path.join(migrationsDir, '0016_gamecenter_shutdown_commands.sql'),
      'utf8',
    );
    assert.match(shutdown, /CHECK \(command IN \('wake', 'shutdown'\)\)/);
    const agents = readFileSync(
      path.join(migrationsDir, '0017_gamecenter_agents.sql'),
      'utf8',
    );
    assert.match(agents, /CREATE TABLE IF NOT EXISTS gamecenter_agents/);
    assert.match(agents, /CHECK \(role IN \('main', 'client'\)\)/);
    assert.match(agents, /ADD COLUMN IF NOT EXISTS mode text/);
    assert.match(agents, /CHECK \(mode IS NULL OR mode IN \('self', 'remote'\)\)/);
  });
});
