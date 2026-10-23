/**
 * Market 1.5.28: every receipt reaches Əməliyyatlar → Satışlar
 * (marketpos/electron/ops-engine.cjs feedSales). Before, a receipt whose
 * product was not a good in Mallar was marked done without being written.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { OpsEngine, stockBefore } = require('../../../marketpos/electron/ops-engine.cjs');

function engine(sales: unknown[], settings: Record<string, unknown>) {
  const e = Object.create(OpsEngine.prototype);
  let state = { ...settings };
  const booked: any[] = [];
  e.busy = {};
  e.registers = new Map();
  e.settings = () => state;
  e.saveSettings = (patch: Record<string, unknown>) => { state = { ...state, ...patch }; return state; };
  e.registerName = async () => 'Kassa';
  e.market = { invoke: async (method: string) => (method === 'sale.list' ? { success: true, data: sales } : { success: true, data: [] }) };
  e.invoke = async (method: string, payload: any) => { booked.push({ method, payload }); return { success: true, data: {} }; };
  return { e, booked, state: () => state };
}
const sale = (id: string, productId: string, at: number, extra = {}) => ({ id, receiptNo: id, createdAt: at, registerId: 'r1', totalMinor: 100, payments: [{ method: 'cash', amountMinor: 100 }], items: [{ productId, name: 'Çörək', qty: 1, unitPriceMinor: 100, lineTotalMinor: 100 }], ...extra });

describe('market sales reach the warehouse', () => {
  it('does not drop a receipt whose product is not in Mallar; sets it aside with the reason', async () => {
    const { e, booked, state } = engine([sale('s1', 'p-old', 10)], { links: {}, linkedAt: {} });
    for (let i = 0; i < 3; i++) await e.feedSales();
    expect(booked.filter((b) => b.method === 'sales.recordExternal')).toHaveLength(0);
    expect(state().fed).not.toContain('s1');
    expect(state().parked.s1.error).toContain('Çörək');
    // Once the product is a good and the parked list is cleared, it is booked.
    e.saveSettings({ links: { 'p-old': 'ing-1' }, linkedAt: { 'p-old': 5 } });
    e.retryParked();
    await e.feedSales();
    expect(booked.find((b) => b.method === 'sales.recordExternal')?.payload.lines[0]).toMatchObject({ ingredientId: 'ing-1' });
    expect(state().fed).toContain('s1');
  });
  it('books a receipt older than its good without moving stock again', async () => {
    const { e, booked } = engine([sale('s2', 'p-a', 10)], { links: { 'p-a': 'ing-a' }, linkedAt: { 'p-a': 50 } });
    await e.feedSales();
    expect(booked[0].payload.lines[0].noStock).toBe(true);
    expect(stockBefore('p-a', 60, { 'p-a': 50 })).toBe(false);
    expect(stockBefore('ops-x', 1, { 'ops-x': 50 })).toBe(false);
  });
  it('re-offers recent receipts once after updating (the warehouse ignores ones it has)', async () => {
    const { e, booked, state } = engine([sale('s3', 'ops-ing-3', 10)], { links: { 'p-b': 'ing-b' }, fed: ['s3'] });
    await e.feedSales();
    expect(state().linkedAt['p-b']).toBeGreaterThan(0);
    expect(booked.filter((b) => b.method === 'sales.recordExternal')).toHaveLength(1);
  });
  it('a return waits for its sale, then follows it', async () => {
    const refunded = sale('s4', 'p-c', 10, { refunds: [{ refundId: 'rf1', createdAt: 20, lines: [{ productId: 'p-c', qty: 1, amountMinor: 100 }] }] });
    const { e, booked, state } = engine([refunded], { links: {}, linkedAt: {} });
    await e.feedSales();
    expect(booked.filter((b) => b.method === 'sales.recordExternalRefund')).toHaveLength(0);
    expect(state().fed ?? []).not.toContain('r:rf1');
    e.saveSettings({ links: { 'p-c': 'ing-c' }, linkedAt: { 'p-c': 1 }, failures: {} });
    await e.feedSales();
    expect(booked.map((b) => b.method)).toEqual(['sales.recordExternal', 'sales.recordExternalRefund']);
  });
});
