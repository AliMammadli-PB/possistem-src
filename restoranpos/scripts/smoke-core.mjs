#!/usr/bin/env node
/**
 * End-to-end smoke test for the C++ sidecar.
 *
 * Spawns the real executable against a throwaway database and drives it over
 * the same NDJSON protocol Electron uses, so a protocol regression fails here
 * rather than as a mysterious spinner in the UI.
 *
 *   node scripts/smoke-core.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe');
const PROTOCOL_VERSION = 1;

if (!fs.existsSync(EXE)) {
  console.error(`[smoke] core not built: ${EXE}\n        Run: npm run build:core`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-smoke-'));
const dbPath = path.join(workDir, 'smoke.db');
const logDir = path.join(workDir, 'logs');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const child = spawn(EXE, ['--db', dbPath, '--log-dir', logDir, '--protocol', String(PROTOCOL_VERSION)], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  shell: false,
});

const pending = new Map();
const events = [];
let buffer = '';
let stdoutBytes = 0;
let nonProtocolLines = 0;

child.stdout.on('data', (chunk) => {
  stdoutBytes += chunk.length;
  buffer += chunk.toString('utf8');

  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // Every byte on stdout must be a protocol frame; anything else is a bug.
      nonProtocolLines++;
      console.log(`  !! non-protocol stdout: ${line.slice(0, 120)}`);
      continue;
    }

    if (message.type === 'event') {
      events.push(message);
      continue;
    }
    const resolver = pending.get(message.requestId);
    if (resolver) {
      pending.delete(message.requestId);
      resolver(message);
    }
  }
});

// stderr must be drained or the child blocks on its next log write.
const stderrLines = [];
child.stderr.on('data', (chunk) => {
  stderrLines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
});

function call(method, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`timeout waiting for ${method}`));
    }, timeoutMs);

    pending.set(requestId, (message) => {
      clearTimeout(timer);
      resolve(message);
    });

    child.stdin.write(
      JSON.stringify({
        requestId,
        method,
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now(),
        payload,
      }) + '\n',
    );
  });
}

function waitForEvent(name, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = setInterval(() => {
      const found = events.find((e) => e.event === name);
      if (found) {
        clearInterval(poll);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(poll);
        reject(new Error(`timeout waiting for event ${name}`));
      }
    }, 25);
  });
}

async function main() {
  console.log('\n[smoke] POS core protocol test');
  console.log(`[smoke] db: ${dbPath}\n`);

  const ready = await waitForEvent('core.ready');
  check('core.ready received', true);
  check('protocol version matches', ready.payload.protocolVersion === PROTOCOL_VERSION,
    `got ${ready.payload.protocolVersion}`);

  const stages = events.filter((e) => e.event === 'core.stage');
  check('startup stages reported', stages.length >= 4, `${stages.length} stages`);
  console.log(`        stages: ${stages.map((s) => s.payload.key).join(' -> ')}`);

  const ping = await call('core.ping');
  check('core.ping succeeds', ping.success === true);

  const info = await call('core.info');
  check('core.info returns version', info.success && typeof info.data.version === 'string',
    JSON.stringify(info.error));

  // Unauthenticated access must be refused.
  const denied = await call('catalog.categories');
  check('catalog requires auth', denied.success === false && denied.error.code === 'E_UNAUTHORIZED',
    JSON.stringify(denied.error));

  const users = await call('auth.listUsers');
  check('auth.listUsers returns demo staff', users.success && users.data.users.length >= 3,
    JSON.stringify(users.error));

  const manager = users.data?.users?.find((u) => u.code === '1001');
  check('manager demo user exists', Boolean(manager));

  const badLogin = await call('auth.login', { userId: manager.id, pin: '0000' });
  check('wrong PIN rejected', badLogin.success === false && badLogin.error.code === 'E_INVALID_PIN',
    JSON.stringify(badLogin.error));

  const login = await call('auth.login', { userId: manager.id, pin: '1001' });
  check('manager login succeeds', login.success === true, JSON.stringify(login.error));
  check('session carries permissions',
    login.success && login.data.session.permissions.includes('order.void'));

  const categories = await call('catalog.categories');
  check('11 categories seeded', categories.success && categories.data.categories.length === 11,
    `got ${categories.data?.categories?.length}`);

  const products = await call('catalog.products');
  check('40+ products seeded', products.success && products.data.products.length >= 40,
    `got ${products.data?.products?.length}`);

  const steak = products.data?.products?.find((p) => p.sku === 'SK-01');
  check('wagyu priced in minor units', steak?.priceMinor === 16500, `got ${steak?.priceMinor}`);

  const detail = await call('catalog.product', { productId: 'itm-wagyu' });
  const doneness = detail.data?.modifierGroups?.find((g) => g.id === 'mg-doneness');
  check('modifier groups attached', Boolean(doneness), 'mg-doneness missing');
  check('doneness group is required', doneness?.required === 1 && doneness?.minSelect === 1);
  check('doneness has 5 options', doneness?.modifiers?.length === 5,
    `got ${doneness?.modifiers?.length}`);

  const search = await call('catalog.products', { search: 'Wagyu' });
  check('search filters products', search.success && search.data.products.length === 1,
    `got ${search.data?.products?.length}`);

  const unknown = await call('does.not.exist');
  check('unknown method rejected', unknown.success === false &&
    unknown.error.code === 'E_UNKNOWN_METHOD');

  // Protocol hygiene: stdout must contain frames only.
  check('stdout carried only protocol frames', nonProtocolLines === 0,
    `${nonProtocolLines} stray line(s)`);
  check('stderr received log output', stderrLines.length > 0);

  console.log(`\n[smoke] stdout bytes: ${stdoutBytes}, stderr lines: ${stderrLines.length}`);
}

main()
  .catch((err) => {
    failed++;
    console.error(`\n[smoke] ERROR: ${err.message}`);
    if (stderrLines.length) {
      console.error('[smoke] last core stderr:');
      stderrLines.slice(-12).forEach((l) => console.error(`        ${l}`));
    }
  })
  .finally(async () => {
    // EOF on stdin is the clean shutdown path.
    const exitCode = await new Promise((resolve) => {
      child.once('exit', resolve);
      child.stdin.end();
      setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000);
    });

    check('core exited cleanly on stdin EOF', exitCode === 0, `exit code ${exitCode}`);
    check('database file created', fs.existsSync(dbPath));

    console.log(`\n[smoke] ${passed} passed, ${failed} failed\n`);
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    process.exit(failed === 0 ? 0 : 1);
  });
