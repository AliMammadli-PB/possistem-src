'use strict';

/**
 * Əməliyyatlar for Market POS (1.5.0): the restaurant's warehouse system runs
 * here as a second core (restaurant-pos-core, its own ops.db) and its screens
 * open inside the Market window.
 *
 * Two bridges keep the till and the warehouse in step:
 *  - catalog: goods made in Mallar become Market products "ops-<good>" with the
 *    price for this shop's branch, its PLU and the stock the warehouse holds;
 *  - sales: every closed Market sale (and return) is written into the
 *    warehouse once, so stock, kassalar and Satışlar follow the till.
 *
 * Runs on the till marked as the warehouse PC (market-ops.json, on by default);
 * the other tills only sell, and receive the products through Market's sync.
 */
const path = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');

const UNIT = { kg: 'kq', l: 'litr', 'ədəd': 'əd', qab: 'əd', q: 'kq' };
/** What a "warehouse" Market role may do in Əməliyyatlar; a manager may do all. */
const WAREHOUSE_METHODS = /^(categories|goods|stocktake|ingredients|inventory|warehouses|purchases|suppliers|supplierItems|lots|locations|replenish|stockRules|recipes)\.|^reports\.(expiry|suppliers|stockLoss)$|^permissions\.list$|^cashAccounts\.list$/;
const CATALOG_WRITES = /^(ingredients\.(save|deactivate)|goods\.(import|prices)|categories\.|purchases\.|inventory\.|stocktake\.post|lots\.)/;

const ok = (data) => ({ success: true, data, error: null });
const fail = (code, message) => ({ success: false, data: null, error: { code, message, retryable: false } });

/** A warehouse good as the Market product the selling screen uses. */
function marketProduct(good, have) {
  const top = String(good.categoryPath || '').split(' / ')[0].trim();
  const name = String(good.name || '');
  return {
    id: `ops-${good.id}`,
    sku: `OPS-${good.id}`,
    barcode: String(good.barcode || ''),
    name: { az: name, ru: name, en: name },
    category: top || 'Digər',
    unit: UNIT[good.unit] || 'əd',
    priceMinor: Math.max(0, Math.round(Number(good.salePriceMinor) || 0)),
    costMinor: Math.max(0, Math.round(Number(good.costMinor) || 0)),
    minStock: Math.max(0, Math.round((Number(good.minQtyMilli) || 0) / 1000)),
    taxRate: have?.taxRate ?? 18,
    supplier: have?.supplier ?? '',
    accent: have?.accent ?? '#2563eb',
    image: have?.image ?? { kind: 'sprite', index: 0 },
    active: true,
    createdAt: have?.createdAt ?? Date.now(),
    plu: Number(good.plu) > 0 ? String(good.plu).padStart(5, '0') : '',
    // Market refuses to sell what it thinks is not there; the warehouse knows.
    stock: Math.floor(Math.max(0, Number(good.qtyMilli) || 0) / 1000),
  };
}
function sameProduct(have, want) {
  return have.active === true && have.name?.az === want.name.az &&
    ['sku', 'barcode', 'category', 'unit', 'priceMinor', 'costMinor', 'minStock', 'plu', 'stock']
      .every((key) => String(have[key] ?? '') === String(want[key] ?? ''));
}

/** Market writes a scale line as qty 1 priced by weight; anything else is whole pieces. */
function lineQtyMilli(item) {
  const qty = Math.max(0, Number(item.qty) || 0);
  const unitPrice = Number(item.unitPriceMinor) || 0;
  const gross = (Number(item.lineTotalMinor) || 0) + (Number(item.discountMinor) || 0);
  if (qty === 1 && unitPrice > 0 && Math.abs(gross - unitPrice) > 1) return Math.max(1, Math.round((gross * 1000) / unitPrice));
  return qty * 1000;
}

/** How a sale was paid, as the warehouse books it. */
function saleMoney(sale) {
  const p = sale.payment || {};
  const total = Number(sale.totalMinor) || 0;
  const credit = Math.max(0, Number(sale.creditMinor) || 0);
  const loyalty = Math.max(0, Number(p.loyaltyMinor) || 0);
  const card = Math.max(0, Number(p.cardMinor ?? (p.method === 'card' ? total - credit - loyalty : 0)) || 0);
  const cash = Math.max(0, total - credit - card - loyalty);
  return { cash, card, credit };
}

/** The warehouse lines of a sale (products that did not come from Mallar are skipped). */
function saleLines(items) {
  return (items || []).filter((item) => String(item.productId || '').startsWith('ops-')).map((item) => ({
    ingredientId: String(item.productId).slice(4),
    qtyMilli: lineQtyMilli(item),
    unitPriceMinor: Number(item.unitPriceMinor) || 0,
    totalMinor: Math.max(0, Number(item.lineTotalMinor) || 0),
  }));
}

class OpsEngine {
  constructor({ market, searchDirs = [] }) {
    this.market = market;
    // Required here, not at the top: the mapping helpers below load without Electron (tests).
    const { CoreSupervisor } = require('./core-supervisor.cjs');
    this.core = new CoreSupervisor({
      binaryName: 'restaurant-pos-core', dbFile: 'ops.db', label: 'ops-core', searchDirs,
      env: { POS_SEED_DEMO_MENU: '0', POS_LOG_LEVEL: 'info' },
    });
    this.admin = null;
    this.timer = null;
    this.catalogTimer = null;
    this.busy = { catalog: false, feed: false, again: false };
    this.registers = new Map();
    this.methods = null;
  }

  settingsFile() { return path.join(require('electron').app.getPath('userData'), 'market-ops.json'); }
  settings() { try { return JSON.parse(readFileSync(this.settingsFile(), 'utf8')); } catch { return {}; } }
  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    writeFileSync(this.settingsFile(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
  isHost() { return this.settings().host !== false; }

  async start(customerId) {
    if (!this.isHost() || this.core.state === 'ready' || this.core.state === 'starting') return;
    this.admin = null;
    await this.core.start(customerId);
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), 15000);
    this.timer.unref?.();
    void this.tick();
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    await this.core.stop();
  }
  status() {
    return { host: this.isHost(), state: this.core.state, available: Boolean(this.core.resolveCorePath()) };
  }

  /** The method list the screens may call (built next to them as ops/methods.json). */
  allowed(method, role) {
    if (!this.methods) {
      try { this.methods = new Set(JSON.parse(readFileSync(path.join(__dirname, '..', 'dist', 'ops', 'methods.json'), 'utf8'))); }
      catch { this.methods = new Set(); }
    }
    if (!this.methods.has(method)) return false;
    return role === 'manager' || WAREHOUSE_METHODS.test(method);
  }

  /** The warehouse core's administrator: every call from Market acts as it. */
  async actor() {
    if (this.admin) return this.admin;
    const res = await this.core.invoke('auth.listUsers', {}, 8000);
    const users = res?.success && Array.isArray(res.data?.users) ? res.data.users : [];
    const role = (u) => String(u?.role || u?.roleName || '').toLowerCase();
    const admin = users.find((u) => role(u) === 'administrator') || users.find((u) => role(u).includes('admin'));
    if (admin) this.admin = { id: String(admin.id), code: String(admin.code || '') };
    return this.admin;
  }

  async invoke(method, payload, { terminal, idempotencyKey, timeoutMs } = {}) {
    if (this.core.state !== 'ready') return fail('E_CORE_DOWN', 'Anbar sistemi hazır deyil');
    const admin = await this.actor();
    if (!admin) return fail('E_NO_ADMIN', 'Anbar sistemində administrator tapılmadı');
    const res = await this.core.invoke(method, payload ?? {}, {
      actor: { userId: admin.id }, terminal: terminal || { id: 'market-ops', name: 'Market' }, idempotencyKey, timeoutMs: timeoutMs || 15000,
    });
    if (res?.success && CATALOG_WRITES.test(method)) this.scheduleCatalog();
    return { success: Boolean(res?.success), data: res?.data ?? null, error: res?.error ?? null };
  }

  /** What the screens are allowed to show this Market user. */
  async session(staff) {
    const admin = await this.actor();
    if (!admin) throw new Error('Anbar sistemi hazır deyil');
    const perms = await this.invoke('permissions.list', {}, { timeoutMs: 8000 });
    let keys = [];
    if (perms.success) for (const list of Object.values(perms.data?.groups || {})) for (const p of Array.isArray(list) ? list : []) if (p?.key) keys.push(String(p.key));
    if (staff.role !== 'manager') keys = keys.filter((k) => /^(inventory|suppliers|recipes)\./.test(k));
    return ok({ userId: admin.id, code: admin.code, fullName: staff.name, role: 'administrator', shiftId: null, permissions: keys, loginAt: Date.now(), authenticated: true });
  }

  async tick() {
    if (this.core.state !== 'ready' || this.market.state !== 'ready') return;
    try { await this.feedSales(); } catch (error) { console.error('[ops-feed]', error?.message || error); }
    try { await this.syncCatalog(); } catch (error) { console.error('[ops-catalog]', error?.message || error); }
  }

  scheduleCatalog() {
    clearTimeout(this.catalogTimer);
    this.catalogTimer = setTimeout(() => { void this.syncCatalog().catch((error) => console.error('[ops-catalog]', error?.message || error)); }, 800);
  }

  async syncCatalog() {
    if (this.busy.catalog) { this.busy.again = true; return; }
    if (this.core.state !== 'ready' || this.market.state !== 'ready') return;
    this.busy.catalog = true;
    try {
      const goodsRes = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
      if (!goodsRes.success) return;
      const listRes = await this.market.invoke('product.list', { activeOnly: false }, 60000);
      if (!listRes?.success || !Array.isArray(listRes.data)) return;
      const existing = new Map(listRes.data.filter((p) => String(p.id).startsWith('ops-')).map((p) => [p.id, p]));
      const seen = new Set();
      for (const good of goodsRes.data?.goods ?? []) {
        const want = marketProduct(good, existing.get(`ops-${good.id}`));
        seen.add(want.id);
        const have = existing.get(want.id);
        if (have && sameProduct(have, want)) continue;
        const res = await this.market.invoke(have ? 'product.update' : 'product.create', { product: want, actorId: 'system' }, 15000);
        if (!res?.success) console.error('[ops-catalog]', want.sku, res?.error?.message);
      }
      for (const [id, have] of existing) {
        if (seen.has(id) || !have.active) continue;
        await this.market.invoke('product.update', { product: { ...have, active: false }, actorId: 'system' }, 15000);
      }
    } finally {
      this.busy.catalog = false;
      if (this.busy.again) { this.busy.again = false; this.scheduleCatalog(); }
    }
  }

  /**
   * The branch (obyekt) whose prices this shop sells at: the one a Market
   * register's kassa belongs to in Kassalar (terminal "market-<register>").
   */
  async branchObject() {
    if (this.settings().objectId) return this.settings().objectId;
    const now = Date.now();
    const res = await this.invoke('cashAccounts.list', { from: now - 864e5, to: now + 864e5 }, { timeoutMs: 15000 });
    const till = (res.data?.accounts ?? []).find((a) => a.kind === 'till' && String(a.terminalId || '').startsWith('market-') && a.objectId);
    return till ? String(till.objectId) : '';
  }

  async registerName(id) {
    if (!this.registers.has(id)) {
      const res = await this.market.invoke('cash.listRegisters', {}, 8000);
      for (const r of Array.isArray(res?.data) ? res.data : []) this.registers.set(String(r.id), String(r.name || r.code || r.id));
    }
    return this.registers.get(id) || id;
  }

  /** Closed Market sales and returns → the warehouse, each once. */
  async feedSales() {
    if (this.busy.feed) return;
    this.busy.feed = true;
    try {
      const res = await this.market.invoke('sale.list', {}, 60000);
      if (!res?.success || !Array.isArray(res.data)) return;
      const fed = new Set(this.settings().fed || []);
      const before = fed.size;
      for (const sale of res.data.slice().reverse()) {
        const terminal = { id: `market-${sale.registerId || 'kassa'}`, name: await this.registerName(String(sale.registerId || '')) };
        if (!fed.has(sale.id)) {
          if (!(await this.recordSale(sale, terminal))) continue;
          fed.add(sale.id);
        }
        const money = saleMoney(sale);
        const refundMoney = (amount) => money.card > 0 && money.cash === 0 ? { cardMinor: amount }
          : money.cash === 0 && money.card === 0 && money.credit > 0 ? { creditMinor: amount } : { cashMinor: amount };
        for (const refund of sale.refunds || []) {
          const key = `r:${refund.refundId}`;
          if (fed.has(key)) continue;
          const amount = (refund.lines || []).reduce((t, l) => t + (Number(l.amountMinor) || 0), 0);
          const lines = (refund.lines || []).filter((l) => String(l.productId).startsWith('ops-'))
            .map((l) => ({ ingredientId: String(l.productId).slice(4), qtyMilli: (Number(l.qty) || 0) * 1000 }));
          if (await this.recordRefund(key, sale.id, lines, refundMoney(amount), refund.createdAt, terminal)) fed.add(key);
        }
        const full = `r:${sale.id}`;
        if (sale.refunded && !(sale.refunds || []).length && !fed.has(full)) {
          const lines = saleLines(sale.items).map((l) => ({ ingredientId: l.ingredientId, qtyMilli: l.qtyMilli }));
          if (await this.recordRefund(full, sale.id, lines, { cashMinor: money.cash, cardMinor: money.card, creditMinor: money.credit }, Date.now(), terminal)) fed.add(full);
        }
      }
      if (fed.size !== before) this.saveSettings({ fed: [...fed].slice(-4000) });
    } finally {
      this.busy.feed = false;
    }
  }

  async recordSale(sale, terminal) {
    const lines = saleLines(sale.items);
    if (!lines.length) return true;  // nothing from Mallar on this receipt
    const money = saleMoney(sale);
    const linesTotal = lines.reduce((t, l) => t + l.totalMinor, 0);
    const res = await this.invoke('sales.recordExternal', {
      externalId: sale.id, number: sale.receiptNo, at: Number(sale.createdAt) || Date.now(), lines,
      cashMinor: money.cash, cardMinor: money.card, creditMinor: money.credit,
      discountMinor: Math.max(0, linesTotal - (money.cash + money.card + money.credit)),
    }, { terminal, idempotencyKey: `mkt-sale-${sale.id}`, timeoutMs: 30000 });
    if (!res.success) console.error('[ops-feed] sale', sale.receiptNo, res.error?.message);
    return res.success;
  }

  async recordRefund(externalId, saleId, lines, money, at, terminal) {
    const res = await this.invoke('sales.recordExternalRefund', {
      externalId, saleExternalId: saleId, lines, at: Number(at) || Date.now(), reason: 'Market qaytarma', ...money,
    }, { terminal, idempotencyKey: `mkt-${externalId}`, timeoutMs: 30000 });
    if (!res.success && res.error?.code !== 'E_NOT_FOUND') console.error('[ops-feed] refund', externalId, res.error?.message);
    return res.success;
  }
}

module.exports = { OpsEngine, marketProduct, sameProduct, lineQtyMilli, saleMoney, saleLines, ok, fail };
