/** Book-keeping snapshots the till pushes to the owner portal. */
import { stockOf } from './domain';
import type { marketCoreClient } from './core/client';

import type { PersistedState } from './types';

export function stockLines(state: PersistedState) {
  const clip = (value: string, max: number) => value.slice(0, max);
  const lines = [];
  for (const product of state.products) {
    if (!product.id) continue;
    for (const warehouse of state.warehouses) {
      if (!warehouse.id) continue;
      const name = clip(product.name.az || product.sku || 'Məhsul', 160) || 'Məhsul';
      lines.push({
        id: clip(product.id, 64),
        name,
        barcode: clip(product.barcode || '', 80),
        group: clip(product.category || '', 80),
        unit: clip(product.unit || 'ədəd', 16),
        salePrice: Math.max(0, Math.trunc(product.priceMinor) || 0),
        costPrice: Math.max(0, Math.trunc(product.costMinor) || 0),
        warehouseId: clip(warehouse.id, 64),
        warehouseName: clip(warehouse.name || '', 100),
        qty: Math.trunc(Number(product.warehouseStock[warehouse.id]) || 0),
        minQty: Math.max(0, Math.trunc(product.minStock) || 0),
      });
    }
  }
  lines.sort((left, right) => Math.abs(right.qty) - Math.abs(left.qty));
  return lines;
}

export function marketBooks(state: PersistedState, cashMovements?: Array<{ id: string; kind: string; amountMinor: number; reason: string; createdAt: number }>, finance?: Awaited<ReturnType<typeof marketCoreClient.portal.finance>>) {
  const clip = (value: string, max: number) => value.slice(0, max);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = state.sales.filter((sale) => !sale.refunded && sale.createdAt >= dayStart.getTime());
  const sold = new Map<string, { name: string; qty: number; total: number }>();
  let profit = 0;
  // One index per call: a product lookup per sold line was O(lines × products).
  const productsById = new Map(state.products.map((row) => [row.id, row]));
  for (const sale of today) {
    let cost = 0;
    for (const line of sale.items) {
      const product = productsById.get(line.productId);
      const name = clip(product?.name.az || line.productId, 160);
      const row = sold.get(name) ?? { name, qty: 0, total: 0 };
      row.qty += Math.max(0, Math.trunc(line.qty) || 0);
      row.total += Math.max(0, Math.trunc((product?.priceMinor ?? 0) * line.qty) || 0);
      sold.set(name, row);
      cost += (product?.costMinor ?? 0) * line.qty;
    }
    profit += sale.totalMinor - cost;
  }
  const cash = today.reduce((sum, sale) => sum + (sale.payment.method === 'card' ? 0 : sale.payment.cashMinor ?? sale.payment.amountMinor), 0);
  const card = today.reduce((sum, sale) => sum + (sale.payment.method === 'cash' ? 0 : sale.payment.cardMinor ?? sale.payment.amountMinor), 0);
  const names = [...new Set(state.sales.map((sale) => sale.customerName).filter((name): name is string => Boolean(name)))];
  return {
    sales: state.sales.slice(0, 5000).map((sale) => ({ id: clip(sale.id, 64), no: clip(sale.receiptNo, 40), total: Math.trunc(sale.totalMinor) || 0, at: Math.trunc(sale.createdAt) || 0, refunded: sale.refunded })),
    orders: state.heldCarts.slice(0, 40).map((cart) => ({ id: clip(cart.id, 64), label: clip(cart.label, 80), at: Math.trunc(cart.createdAt) || 0, lines: cart.lines.length })),
    points: state.registers.slice(0, 30).map((register) => ({ id: clip(register.id, 64), name: clip(register.name, 80), status: register.status })),
    products: state.products.filter((product) => product.id).slice(0, 20000).map((product) => ({ id: clip(product.id, 64), name: clip(product.name.az || product.sku || 'Məhsul', 160), qty: Math.trunc(stockOf(product)) || 0, price: Math.max(0, Math.trunc(product.priceMinor) || 0) })),
    customers: finance?.customers.slice(0, 5000).map((row) => ({ id: clip(row.id, 80), name: clip(row.name, 120), debtMinor: Math.trunc(row.debtMinor) || 0 })) ?? names.slice(0, 80).map((name) => ({ id: clip(name, 80), name: clip(name, 120) })),
    suppliers: finance?.suppliers.slice(0, 5000).map((row) => ({ id: clip(row.id, 80), name: clip(row.name, 120), dueMinor: Math.trunc(row.dueMinor) || 0 })) ?? state.purchaseOrders.slice(0, 40).map((order) => ({ id: clip(order.supplier, 80), name: clip(order.supplier || 'Təchizatçı', 80) })),
    ...(finance ? { payments: finance.payments.slice(0, 5000).map((row) => ({ id: clip(row.id, 80), partyType: row.partyType, partyId: clip(row.partyId, 80), partyName: clip(row.partyName, 120), amountMinor: Math.trunc(row.amountMinor) || 0, note: clip(row.note || '', 160), createdAt: Math.trunc(row.createdAt) || 0 })) } : {}),
    purchases: state.purchaseOrders.slice(0, 5000).map((order) => ({ id: clip(order.id, 64), number: clip(order.id, 40), supplierName: clip(order.supplier || 'Təchizatçı', 80), warehouseId: clip(order.warehouseId, 64), status: order.status, totalMinor: order.lines.reduce((sum, line) => sum + line.qty * line.costMinor, 0), createdAt: Math.trunc(order.createdAt) || 0 })),
    ...(cashMovements ? { cashMovements: cashMovements.slice(0, 5000).map((row) => ({ id: clip(row.id, 64), kind: clip(row.kind, 32), amountMinor: Math.trunc(row.amountMinor) || 0, reason: clip(row.reason || '', 160), createdAt: Math.trunc(row.createdAt) || 0 })) } : {}),
    daily: { sales: Math.max(0, today.reduce((sum, sale) => sum + sale.totalMinor, 0)), cash: Math.max(0, cash), card: Math.max(0, card), count: today.length, profit: Math.trunc(profit) || 0 },
    turnover: [...sold.values()].sort((left, right) => right.qty - left.qty).slice(0, 30),
  };
}

