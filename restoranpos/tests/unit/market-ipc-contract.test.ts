/**
 * No Market POS IPC channel exists without a declared authorisation rule, and
 * every handler enforces the rule it declares. See
 * marketpos/shared/contracts/ipc-contract.json.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../marketpos');
const read = (rel: string) => fs.readFileSync(path.join(MARKET, rel), 'utf8');
const contract = JSON.parse(read('shared/contracts/ipc-contract.json')).channels as Record<string, { auth: string; why?: string }>;

function handlers(rel: string) {
  const src = read(rel);
  const found = [...src.matchAll(/ipcMain\.handle\('([^']+)'/g)];
  return Object.fromEntries(found.map((m, k) => [m[1], src.slice(m.index, found[k + 1]?.index ?? src.length)]));
}

const bodies: Record<string, string> = { ...handlers('electron/main.cjs'), ...handlers('electron/hardware-ipc.cjs') };
const SESSION_CHECK = /requireSession\(|requireCorePermission\(|openDrawerAuthorized\(|authorizeCorePayload\(/;

describe('market IPC contract', () => {
  it('declares exactly the channels main registers', () => {
    expect(Object.keys(bodies).sort()).toEqual(Object.keys(contract).sort());
  });

  it('checks the calling frame on every channel', () => {
    for (const [channel, body] of Object.entries(bodies)) expect(body, channel).toContain('assertTrusted(event)');
  });

  it('enforces each declared rule', () => {
    for (const [channel, { auth, why }] of Object.entries(contract)) {
      const body = bodies[channel]!;
      if (auth === 'none') {
        expect(why, `${channel} must say why it is open`).toBeTruthy();
        continue;
      }
      expect(body, channel).toMatch(SESSION_CHECK);
      if (auth.startsWith('roles:')) {
        const roles = auth.slice(6).split(',').map((r) => `'${r}'`).join(', ');
        expect(body, channel).toContain(`[${roles}]`);
      }
      if (auth.startsWith('core:')) {
        for (const permission of auth.slice(5).split('|')) expect(body, channel).toContain(`'${permission}'`);
      }
    }
  });

  it('exposes nothing in the preload that the contract does not declare', () => {
    const preload = read('electron/preload.cjs');
    const used = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(30);
    for (const channel of used) expect(contract, channel).toHaveProperty([channel]);
    expect(used).not.toContain('market:auth:verifyManagerPin');
  });
});
