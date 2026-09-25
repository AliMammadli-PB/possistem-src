/**
 * The seeded 9001 PIN is public. The core refuses it with E_PIN_CHANGE_REQUIRED
 * (native/tests/default_pin_test.cpp); the login pad must turn that into a
 * "choose a new PIN twice" step and send it as auth.login {pin, newPin}.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('restaurant default PIN', () => {
  it('preload forwards newPin to the core', () => {
    const preload = read('out/preload/index.js');
    expect(preload).toContain('login: (userId, pin, newPin) =>');
    expect(preload).toContain('newPin ? { userId: userId ?? "", pin, newPin }');
  });

  it('login pad asks for the new PIN twice and signs in with it', () => {
    const bundle = read('index-DAmHwBc4.js');
    expect(bundle).toContain('if (res.error.code === "E_PIN_CHANGE_REQUIRED")');
    expect(bundle).toContain('window.pos.auth.login(null, pinChange.old, pin)');
    expect(bundle).toContain('pinChange.first !== pin');
  });

  it('the core contract knows the error', () => {
    expect(read('shared/contracts/protocol.json')).toContain('"E_PIN_CHANGE_REQUIRED"');
  });
});
