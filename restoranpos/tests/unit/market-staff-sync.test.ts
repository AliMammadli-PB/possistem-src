/**
 * Market 1.5.31: an account's users on every PC (marketpos/electron/staff-auth.cjs mergeStaff).
 * The PIN set on one PC (8855) signs in on the account's other PC too.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { mergeStaff, DEFAULT_STAFF, newPinCredential, findStaffByPin } = require('../../../marketpos/electron/staff-auth.cjs');

describe('market users across PCs', () => {
  it('replaces a fresh PC placeholder with the account manager and their PIN', () => {
    const remote = [{ id: 'u-manager', name: 'Cavid', role: 'manager', active: true, ...newPinCredential('8855'), registerIds: [], updatedAt: 100 }];
    const merged = mergeStaff(DEFAULT_STAFF, remote);
    expect(findStaffByPin(merged, '8855')?.name).toBe('Cavid');
  });
  it('adds a new user, and a later change wins either way', () => {
    const mine = [{ id: 'u-manager', name: 'Müdir', role: 'manager', active: true, ...newPinCredential('4711'), updatedAt: 500 }];
    const remote = [
      { id: 'u-manager', name: 'Köhnə', role: 'manager', active: true, ...newPinCredential('1234'), updatedAt: 100 },
      { id: 'u-9', name: 'Kassir Əli', role: 'cashier', active: true, ...newPinCredential('3344'), updatedAt: 200 },
      { id: 'u-10', name: 'PIN-siz', role: 'cashier', active: true, updatedAt: 300 },
    ];
    const merged = mergeStaff(mine, remote);
    expect(merged.find((r: any) => r.id === 'u-manager').name).toBe('Müdir');
    expect(findStaffByPin(merged, '3344')?.name).toBe('Kassir Əli');
    expect(merged.some((r: any) => r.id === 'u-10')).toBe(false);
  });
  it('a user deactivated elsewhere is deactivated here; nothing changed returns the same list', () => {
    const mine = [{ id: 'u-manager', name: 'M', role: 'manager', active: true, ...newPinCredential('4711'), updatedAt: 5 }, { id: 'u-9', name: 'Ə', role: 'cashier', active: true, ...newPinCredential('3344'), updatedAt: 5 }];
    const merged = mergeStaff(mine, [{ ...mine[1], active: false, updatedAt: 9 }]);
    expect(merged.find((r: any) => r.id === 'u-9').active).toBe(false);
    expect(mergeStaff(mine, [{ ...mine[1] }])).toBe(mine);
  });
  it('never leaves the PC without an active manager', () => {
    const mine = [{ id: 'u-manager', name: 'M', role: 'manager', active: true, ...newPinCredential('4711'), updatedAt: 5 }];
    expect(mergeStaff(mine, [{ ...mine[0], active: false, updatedAt: 9 }])).toBe(mine);
  });
});
