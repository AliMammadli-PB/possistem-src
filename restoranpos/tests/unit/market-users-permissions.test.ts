/**
 * Market İstifadəçilər (1.5.27): rights come from POSSISTEM, not from the shop.
 * - which right each warehouse document call needs (marketpos/electron/ops-engine.cjs);
 * - a PIN approves only what its owner may do: main passes approverRole and the core checks it;
 * - the users file never carries rights of its own (marketpos/electron/staff-auth.cjs).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { publicStaff, verifyManagerPin, newPinCredential } = require('../../../marketpos/electron/staff-auth.cjs');
const { authorizeCorePayload } = require('../../../marketpos/electron/core-payload.cjs');
const { docPermission } = require('../../../marketpos/electron/ops-engine.cjs');

describe('market user rights', () => {
  it('never exposes the PIN hash or a local rights list', () => {
    const shown = publicStaff({ id: 'u1', role: 'cashier', salt: 'x', pinHash: 'y', permissions: ['docs.view'] });
    expect(shown.pinHash).toBeUndefined();
    expect(shown.salt).toBeUndefined();
    expect(shown.permissions).toBeUndefined();
  });
  it('classifies document calls as view, edit or delete', () => {
    expect(docPermission('purchases.list', {})).toBe('DOCS_VIEW');
    // 1.5.29: making a new document is its own right (migration 017).
    expect(docPermission('purchases.save', {})).toBe('DOCS_CREATE');
    expect(docPermission('business.call', { action: 'correct', cancel: true })).toBe('DOCS_DELETE');
    expect(docPermission('purchases.save', { id: 'po-1' })).toBe('DOCS_EDIT');
    expect(docPermission('income.save', { id: 'inc-1' })).toBe('DOCS_EDIT');
    expect(docPermission('purchases.update', {})).toBe('DOCS_EDIT');
    expect(docPermission('purchases.delete', {})).toBe('DOCS_DELETE');
    expect(docPermission('stocktake.cancel', {})).toBe('DOCS_DELETE');
    expect(docPermission('goods.list', {})).toBe('');
  });
  it('lets any worker PIN name the approver and tells the core their role', () => {
    const head = { id: 'u-head', name: 'Baş', role: 'head_cashier', active: true, ...newPinCredential('482913') };
    const cashier = { id: 'u-kassir', name: 'Kassir', role: 'cashier', active: true, ...newPinCredential('739104') };
    // Only approver roles by default (drawer and older callers)...
    expect(verifyManagerPin([cashier], '739104').ok).toBe(false);
    // ...any worker when the core checks the approver's own rights.
    expect(verifyManagerPin([head, cashier], '739104', null, 'k', { anyRole: true })).toMatchObject({ ok: true, approverId: 'u-kassir', role: 'cashier' });
    const payload = authorizeCorePayload({ productId: 'p', approverRole: 'manager', approverId: 'forged' }, () => ({ id: 'u-kassir', role: 'cashier' }),
      (pin: string) => verifyManagerPin([head, cashier], pin, null, 'k', { anyRole: true }), '482913');
    expect(payload).toMatchObject({ actorId: 'u-kassir', role: 'cashier', approverId: 'u-head', approverRole: 'head_cashier' });
    const unsigned = authorizeCorePayload({ approverRole: 'manager' }, () => ({ id: 'u-kassir', role: 'cashier' }), () => ({ ok: false }), '000000');
    expect(unsigned.approverRole).toBeUndefined();
  });
});
