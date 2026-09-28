/** Owner-portal commands: applying them to the core and remembering their outcome. */
import { marketCoreClient } from './core/client';
import { newId } from './format';

import type { PersistedState, Product, SessionUser } from './types';

export const ACK_KEY = 'market-portal-command-ack';
export const FAIL_KEY = 'market-portal-command-fail';
export const ACK_PENDING_KEY = 'market-portal-command-ack-pending';
export const FAIL_PENDING_KEY = 'market-portal-command-fail-pending';
export const FAIL_REASON_KEY = 'market-portal-command-fail-reasons';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readCommandIds(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).slice(0, 2000) : [];
  } catch { return []; }
}

export function rememberCommandId(key: string, id: string) {
  if (!UUID_RE.test(id)) return;
  localStorage.setItem(key, JSON.stringify([id, ...readCommandIds(key).filter((row) => row !== id)].slice(0, 2000)));
}

export function failedCommandReasons(): Array<{ id: string; reason: string }> {
  try {
    const rows = JSON.parse(localStorage.getItem(FAIL_REASON_KEY) || '[]') as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is { id: string; reason: string } =>
      Boolean(row && typeof row === 'object' && UUID_RE.test(String((row as { id?: string }).id)) &&
        typeof (row as { reason?: string }).reason === 'string')).slice(0, 2000);
  } catch { return []; }
}

export function rememberFailure(id: string, reason: string) {
  rememberCommandId(FAIL_KEY, id);
  rememberCommandId(FAIL_PENDING_KEY, id);
  const rows = failedCommandReasons().filter((row) => row.id !== id);
  localStorage.setItem(FAIL_REASON_KEY, JSON.stringify([{ id, reason: reason.slice(0, 500) }, ...rows].slice(0, 2000)));
}

export function clearPending(key: string, sent: string[]) {
  localStorage.setItem(key, JSON.stringify(readCommandIds(key).filter((id) => !sent.includes(id))));
}

export function productFromCard(body: Record<string, unknown>, existing?: Product): Product {
  const str = (key: string) => (typeof body[key] === 'string' ? body[key].trim() : '');
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const num = (key: string) => Math.trunc(Number(body[key]) || 0);
  const name = str('name');
  const blank: Product = { id: str('id') || newId('product'), sku: str('sku') || str('barcode') || newId('sku'), barcode: str('barcode'), name: { az: name, ru: name, en: name }, category: str('group'), unit: str('unit') || 'ədəd', priceMinor: Math.max(0, num('salePrice')), costMinor: Math.max(0, num('costPrice')), minStock: Math.max(0, num('minStock')), taxRate: has('taxRate') ? num('taxRate') : 18, supplier: str('supplier'), warehouseStock: {}, accent: '#888888', image: { kind: 'sprite', index: 0 }, active: true, createdAt: Date.now() };
  const base = existing ? { ...existing, name: { ...existing.name, az: name || existing.name.az }, barcode: str('barcode') || existing.barcode, sku: str('sku') || existing.sku, category: str('group') || existing.category, unit: str('unit') || existing.unit, priceMinor: has('salePrice') ? Math.max(0, num('salePrice')) : existing.priceMinor, costMinor: has('costPrice') ? Math.max(0, num('costPrice')) : existing.costMinor, minStock: has('minStock') ? Math.max(0, num('minStock')) : existing.minStock, taxRate: has('taxRate') ? num('taxRate') : existing.taxRate, supplier: has('supplier') ? str('supplier') : existing.supplier } : blank;
  return { ...base, kind: str('kind') === 'service' ? 'service' : (has('kind') ? 'product' : base.kind), comment: has('comment') ? str('comment') : base.comment, tags: has('tags') ? str('tags') : base.tags, minPriceMinor: has('minPrice') ? Math.max(0, num('minPrice')) : base.minPriceMinor, weighted: has('weighted') ? body.weighted === true : base.weighted, serial: has('serial') ? body.serial === true : base.serial, station: has('station') ? str('station') : base.station, packUnit: has('packUnit') ? str('packUnit') : base.packUnit, packQty: has('packQty') ? Math.max(0, num('packQty')) : base.packQty, department: has('department') ? str('department') : base.department, priceDiscountMinor: has('priceDiscount') ? Math.max(0, num('priceDiscount')) : base.priceDiscountMinor, priceWholesaleMinor: has('priceWholesale') ? Math.max(0, num('priceWholesale')) : base.priceWholesaleMinor, priceDealerMinor: has('priceDealer') ? Math.max(0, num('priceDealer')) : base.priceDealerMinor };
}

export async function applyMarketCommand(cmd: { id: string; kind: string; body?: Record<string, unknown> }, session: SessionUser, coreReady: boolean, state: PersistedState): Promise<'ok' | 'local' | 'skip'> {
  const body = cmd.body ?? {};
  const str = (key: string) => (typeof body[key] === 'string' ? body[key] : '');
  const num = (key: string) => Math.trunc(Number(body[key]) || 0);
  if (!(coreReady && marketCoreClient.available())) return 'skip';
  if (cmd.kind === 'cash.in' || cmd.kind === 'cash.out') {
    const payload = { registerId: str('registerId'), amountMinor: num('amountMinor'), reason: str('reason'), actorId: session.id, portalCommandId: cmd.id };
    if (cmd.kind === 'cash.in') await marketCoreClient.cash.cashIn(payload);
    else await marketCoreClient.cash.cashOut(payload);
  } else if (cmd.kind === 'customer.pay') {
    await marketCoreClient.customers.payDebt({ customerId: str('customerId'), amountMinor: num('amountMinor'), note: str('note'), actorId: session.id, portalCommandId: cmd.id });
  } else if (cmd.kind === 'supplier.pay') {
    await marketCoreClient.supplier.pay({ supplierName: str('supplierName'), amountMinor: num('amountMinor'), note: str('note'), actorId: session.id, portalCommandId: cmd.id });
  } else if (cmd.kind === 'purchase.order') {
    const lines = Array.isArray(body.lines) ? body.lines : [];
    await marketCoreClient.purchases.create({
      id: `PO-${cmd.id}`, supplier: str('supplierName'), expectedAt: str('expectedAt'),
      createdAt: Date.now(), createdBy: session.id, warehouseId: str('warehouseId'), status: 'ordered',
      lines: lines.map((row) => ({ productId: String((row as Record<string, unknown>).productId || ''), qty: Math.trunc(Number((row as Record<string, unknown>).qty) || 0), costMinor: Math.trunc(Number((row as Record<string, unknown>).unitCostMinor) || 0) })),
    });
  } else if (cmd.kind === 'purchase.receive') {
    await marketCoreClient.purchases.receive(str('purchaseId'), session.id, cmd.id);
  } else if (cmd.kind === 'warehouse.create') {
    const id = str('id') || `wh-${cmd.id}`;
    const existing = state.warehouses.find((row) => row.id === id);
    if (existing && existing.name !== str('name')) throw new Error('Anbar əmri başqa adla artıq işlənib');
    if (!existing) await marketCoreClient.warehouses.create({ id, code: 'WH', name: str('name'), address: '', manager: '', active: true }, session.id);
  } else if (cmd.kind === 'warehouse.rename' || cmd.kind === 'warehouse.close') {
    const existing = state.warehouses.find((row) => row.id === str('id'));
    if (!existing) throw new Error('Anbar tapılmadı');
    await marketCoreClient.warehouses.update(existing.id, cmd.kind === 'warehouse.close' ? existing.name : str('name'), cmd.kind !== 'warehouse.close', session.id);
  } else if (cmd.kind === 'stock.transfer') {
    await marketCoreClient.inventory.transfer({ productId: str('productId'), fromWarehouseId: str('fromWarehouseId'), toWarehouseId: str('toWarehouseId'), qty: Math.abs(num('qty')), actorId: session.id, portalCommandId: cmd.id });
  } else if (cmd.kind === 'stock.waste') {
    await marketCoreClient.inventory.waste({ productId: str('productId'), warehouseId: str('warehouseId'), qty: Math.abs(num('qty')), reason: str('reason') || 'other', actorId: session.id, portalCommandId: cmd.id });
  } else if (cmd.kind === 'stock.receive' || cmd.kind === 'stock.adjust' || cmd.kind === 'stock.count') {
    const fresh = cmd.kind === 'stock.count' ? await marketCoreClient.getState() : state;
    const have = fresh.products.find((row) => row.id === str('productId'))?.warehouseStock[str('warehouseId')] ?? 0;
    const delta = cmd.kind === 'stock.count' ? num('qty') - have : num('qty');
    await marketCoreClient.inventory.adjust({ productId: str('productId'), warehouseId: str('warehouseId'), qtyDelta: delta, note: str('reason') || cmd.kind, actorId: session.id, portalCommandId: cmd.id });
  } else if (cmd.kind === 'product.save') {
    const productId = str('id') || `product-${cmd.id}`;
    const existing = state.products.find((row) => row.id === productId || (str('barcode') && row.barcode === str('barcode')));
    const product = productFromCard({ ...body, id: productId }, existing);
    if (existing) await marketCoreClient.products.save(product, session.id);
    else await marketCoreClient.products.create(product, session.id);
  } else return 'skip';
  return 'ok';
}


