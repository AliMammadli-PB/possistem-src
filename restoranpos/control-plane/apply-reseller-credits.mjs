#!/usr/bin/env node
/**
 * Partners (bayi) pay per month of licence, and renewals reach the tills.
 *
 *  - Credit = month: a sale costs its months (trial 7 days is free, capped per
 *    month), at most 12 per sale; renewing spends again; every movement is in
 *    reseller_credit_ledger. Admin: credits dialog, trial limit, max devices,
 *    ledger, free renewal on Satışlar.
 *  - Partner sales keep their product (a Market sale was issued as Restaurant).
 *  - Resetting a partner's password ends their sessions.
 *  - Both heartbeats carry `licenseRefresh`, a freshly signed licence for an
 *    active one, so a renewed till unlocks without a new key.
 *
 * Runs on the VPS against /opt/possistem-pos-control, a deployed directory
 * rather than a git checkout. Every target file must still be exactly the
 * version this was built from (or already this version): one drifted file and
 * nothing is written. Each replaced file is backed up beside itself.
 *
 *   node apply-reseller-credits.mjs [/opt/possistem-pos-control] [--check]
 *
 * Then: psql -f reseller-credits/0032_reseller_credits.sql, build contracts +
 * api + admin-web + reseller-web, restart. Rollback = restore the .bak files,
 * rebuild, restart (the migration is additive and can stay).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ROOT = args.find((a) => !a.startsWith('--')) || '/opt/possistem-pos-control';
const HERE = path.join(path.dirname(new URL(import.meta.url).pathname), 'reseller-credits');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));

const plan = [];
const drifted = [];
for (const entry of manifest) {
  const target = path.join(ROOT, entry.path);
  const source = path.join(HERE, 'files', entry.path);
  if (md5(source) !== entry.next) throw new Error(`payload damaged: ${entry.path}`);
  const current = fs.existsSync(target) ? md5(target) : null;
  if (current === entry.next) plan.push({ ...entry, action: 'same' });
  else if (current === entry.base) plan.push({ ...entry, action: current ? 'replace' : 'create' });
  else drifted.push(`${entry.path} (now ${current ?? 'missing'}, expected ${entry.base ?? 'missing'})`);
}

if (drifted.length) {
  console.error('Changed on the server since this was built - nothing written:');
  for (const line of drifted) console.error(`  ! ${line}`);
  process.exit(1);
}

for (const step of plan) {
  const target = path.join(ROOT, step.path);
  if (step.action === 'same') {
    console.log(`  = ${step.path}`);
    continue;
  }
  if (CHECK) {
    console.log(`  ~ ${step.path} (${step.action})`);
    continue;
  }
  if (step.action === 'replace') fs.copyFileSync(target, `${target}.bak-${STAMP}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'files', step.path), target);
  console.log(`  + ${step.path} (${step.action})`);
}

console.log(CHECK ? 'check ok - nothing written' : `done; backups end in .bak-${STAMP}`);
