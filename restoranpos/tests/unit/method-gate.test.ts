/**
 * Main gates every IPC call on a table baked into the shipped bundle:
 * `const i = Cn[s]; if (!i) return E_UNKNOWN_METHOD`. That table was generated
 * from protocol.json once and then frozen, so 66 methods added to the contract
 * afterwards - the whole inventory / suppliers / guests / reservations /
 * delivery / roster / roles / report-export surface - were rejected by main
 * before ever reaching the core.
 *
 * Nothing caught it, because the renderer panels guard on `if (!data) return
 * null`: a rejected call looked exactly like a feature that was never built.
 *
 * scripts/apply-restaurant-contract.mjs keeps the two in step. This is the
 * check that fails if they drift again.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Pull the `Cn={...}` object literal out of the minified main bundle. */
function methodGate(): Record<string, { auth: boolean; timeout: number }> {
  const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const head = 'Cn={';
  const open = src.indexOf(head);
  expect(open, 'method table not found in index.js').toBeGreaterThan(-1);

  let depth = 0;
  for (let i = open + head.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func -- reading our own build output
        return new Function(`return ${src.slice(open + head.length - 1, i + 1)}`)();
      }
    }
  }
  throw new Error('method table end not found');
}

const gate = methodGate();
const protocol = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'shared/contracts/protocol.json'), 'utf8'),
) as { methods: Record<string, unknown> };

/** `$comment` keys document sections of the contract; they are not methods. */
const declared = Object.keys(protocol.methods).filter((n) => !n.startsWith('$'));

/**
 * Methods main calls into the core itself, never on the renderer's behalf.
 *
 * They must stay OUT of the gate. The gate is the door the renderer comes
 * through, and the core answers these without checking a permission - putting
 * `roles.applyPolicy` in the table would let the till UI grant itself anything.
 */
const internal = declared.filter(
  (name) => (protocol.methods[name] as { internal?: boolean } | null)?.internal === true,
);
const contractMethods = declared.filter((name) => !internal.includes(name));

describe('main method gate', () => {
  it('admits every method the contract declares', () => {
    const missing = contractMethods.filter((name) => !gate[name]);
    expect(missing, `main would answer E_UNKNOWN_METHOD for: ${missing.join(', ')}`).toEqual([]);
  });

  it('admits the methods main answers itself', () => {
    // These never reach the core - main's own switch handles them - but they
    // still pass through the same gate first.
    for (const name of ['files.saveText', 'files.savePdf']) {
      expect(gate[name], `${name} is handled by main but not admitted`).toBeTruthy();
    }
  });

  it('still admits the methods the till cannot run without', () => {
    for (const name of ['core.ping', 'auth.login', 'orders.create', 'orders.close', 'reports.z']) {
      expect(gate[name], `${name} missing from the gate`).toBeTruthy();
    }
  });

  it('keeps internal methods away from the renderer', () => {
    expect(internal.length, 'no internal methods declared - has the flag moved?')
      .toBeGreaterThan(0);
    for (const name of internal) {
      expect(gate[name], `${name} is internal but the renderer can reach it`).toBeFalsy();
    }
  });

  it('keeps the roles surface reachable', () => {
    // The reported symptom: the permissions panel rendered nothing at all.
    for (const name of ['permissions.list', 'roles.list', 'roles.save', 'roles.delete']) {
      expect(gate[name], `${name} missing - the roles panel renders empty`).toBeTruthy();
    }
  });
});

describe('device heartbeat', () => {
  const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

  it('beats well inside the control API freshness window', () => {
    // customer-live.ts counts a device as connected for 10 minutes after
    // lastSeenAt. The original schedule was 12-24 HOURS, so the portal showed
    // "Bağlantı yoxdur" on a till that was running all day.
    const schedule = main.match(/function Ws\(\)\{return (\d+e?\d*)\+/);
    expect(schedule, 'heartbeat scheduler not found').toBeTruthy();
    const base = Number(schedule![1].replace(/(\d+)e(\d+)/, (_, m, e) => String(m * 10 ** e)));
    expect(base).toBeLessThan(10 * 60_000);
  });

  it('still posts to the device heartbeat endpoint', () => {
    expect(main).toContain('/heartbeat');
  });
});

describe('whatsapp removal', () => {
  const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

  it('leaves no entry point behind', () => {
    // apply-restaurant-admin-ia.mjs used to re-add the hub tile on every launch
    // while apply-restaurant-no-whatsapp.mjs had already marked itself done, so
    // WhatsApp kept coming back - pointing at a route that no longer exists.
    expect(bundle).not.toContain('to: "/settings/whatsapp"');
    expect(bundle).not.toContain('path: "/settings/whatsapp"');
  });

  it('keeps support reachable, since that is where users are sent instead', () => {
    expect(bundle).toContain('/support');
  });
});
