/**
 * Market POS 1.5.0: what crosses between the till and the warehouse system
 * (marketpos/electron/ops-engine.cjs) - goods become products, sales come back.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ops = require('../../../marketpos/electron/ops-engine.cjs');

describe('catalog: a warehouse good as a Market product', () => {
  const good = { id: 'ing-1', name: 'Pomidor', barcode: '2000001', unit: 'kg', categoryPath: 'Tərəvəz / Qırmızı', salePriceMinor: 250, costMinor: 150, minQtyMilli: 5000, plu: 7, qtyMilli: 12500 };

  it('keeps the id, price, top category, unit, PLU and whole stock', () => {
    const p = ops.marketProduct(good, undefined);
    expect(p).toMatchObject({ id: 'ops-ing-1', sku: 'OPS-ing-1', barcode: '2000001', category: 'Tərəvəz', unit: 'kq', priceMinor: 250, costMinor: 150, minStock: 5, plu: '00007', stock: 12, active: true });
    expect(p.name.az).toBe('Pomidor');
  });

  it('is only rewritten when something the till uses changed', () => {
    const p = ops.marketProduct(good, undefined);
    expect(ops.sameProduct({ ...p }, p)).toBe(true);
    expect(ops.sameProduct({ ...p, priceMinor: 260 }, p)).toBe(false);
    expect(ops.sameProduct({ ...p, active: false }, p)).toBe(false);
  });

  it('never sends negative stock to the till', () => {
    expect(ops.marketProduct({ ...good, qtyMilli: -3000 }, undefined).stock).toBe(0);
  });
});

describe('sales: a Market receipt as the warehouse books it', () => {
  it('reads a scale line (qty 1 priced by weight) as its weight', () => {
    expect(ops.lineQtyMilli({ qty: 1, unitPriceMinor: 250, lineTotalMinor: 184 })).toBe(736);
    expect(ops.lineQtyMilli({ qty: 3, unitPriceMinor: 80, lineTotalMinor: 240 })).toBe(3000);
    expect(ops.lineQtyMilli({ qty: 1, unitPriceMinor: 80, lineTotalMinor: 70, discountMinor: 10 })).toBe(1000);
  });

  it('splits the money into cash, card and nisyə', () => {
    expect(ops.saleMoney({ totalMinor: 1000, creditMinor: 300, payment: { method: 'cash' } })).toEqual({ cash: 700, card: 0, credit: 300 });
    expect(ops.saleMoney({ totalMinor: 1000, payment: { method: 'card' } })).toEqual({ cash: 0, card: 1000, credit: 0 });
    expect(ops.saleMoney({ totalMinor: 1000, payment: { method: 'mixed', cardMinor: 400, cashMinor: 600 } })).toEqual({ cash: 600, card: 400, credit: 0 });
  });

  it('only books products that came from Mallar', () => {
    const lines = ops.saleLines([{ productId: 'ops-ing-1', qty: 2, unitPriceMinor: 100, lineTotalMinor: 200 }, { productId: 'p-old', qty: 1, unitPriceMinor: 50, lineTotalMinor: 50 }]);
    expect(lines).toEqual([{ productId: 'ops-ing-1', ingredientId: 'ing-1', qtyMilli: 2000, unitPriceMinor: 100, totalMinor: 200 }]);
  });
});

describe('receipts: a Market sale.receipt as the restaurant receipt document', () => {
  const receipt = {
    storeName: 'Bravo', receiptNo: 'M-0007', createdAt: 1, registerId: 'reg-1', cashierId: 'u-1',
    items: [
      { id: 1, name: 'Su', qty: 2, unit_price_minor: 80, line_total_minor: 160, discount_minor: 0 },
      { id: 2, name: 'Pomidor', unit: 'kq', qty: 1, unit_price_minor: 250, line_total_minor: 184, discount_minor: 0 },
    ],
    subtotalMinor: 344, discountMinor: 44, totalMinor: 300, paymentMethod: 'cash', tenderedMinor: 500, changeMinor: 200, cashMinor: 300, cardMinor: 0,
  };
  const doc = ops.receiptDocument(receipt, { cashierName: 'Aysel', registerName: 'Kassa 1' });

  it('is a shop receipt with the till and the cashier', () => {
    expect(doc).toMatchObject({ orderType: 'retail', receiptNumber: 'M-0007', terminalName: 'Kassa 1', waiterName: 'Aysel', restaurant: { name: 'Bravo' } });
  });

  it('keeps the lines summing to the subtotal and shows the weight of a scale line', () => {
    const sum = doc.items.reduce((t: number, i: { itemLineTotalMinor: number }) => t + i.itemLineTotalMinor, 0);
    expect(sum).toBe(doc.subtotalMinor);
    expect(doc.items[1].name).toBe('Pomidor 0.736 kq');
    expect(doc.discountTotalMinor).toBe(44);
    expect(doc.grandTotalMinor).toBe(300);
  });

  it('prints the cash paid and the change', () => {
    expect(doc.payments).toEqual([{ method: 'cash', label: 'Nağd', amountMinor: 300, tenderedMinor: 500, changeMinor: 200 }]);
  });
});
