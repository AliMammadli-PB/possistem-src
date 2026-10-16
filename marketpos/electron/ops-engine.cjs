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
 * The core runs on every till: it also prints Market's receipts in the
 * restaurant's receipt design (logo, QR, header - receipt.renderExternal).
 * The two bridges run only on the till marked as the warehouse PC
 * (market-ops.json, on by default); the other tills only sell, and receive the
 * products through Market's sync.
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
function marketProduct(good, have, productId) {
  const top = String(good.categoryPath || '').split(' / ')[0].trim();
  const name = String(good.name || '');
  return {
    id: productId || `ops-${good.id}`,
    // A Market product brought into Mallar keeps its own id and SKU.
    sku: productId && have?.sku ? have.sku : `OPS-${good.id}`,
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

/** The warehouse good behind a Market product: ops-<good>, or a product linked to one. */
function goodOf(productId, links = {}) {
  const id = String(productId || '');
  return id.startsWith('ops-') ? id.slice(4) : (links[id] || '');
}

/** The warehouse lines of a sale (products with no good in Mallar are skipped). */
function saleLines(items, links = {}) {
  return (items || []).filter((item) => goodOf(item.productId, links)).map((item) => ({
    ingredientId: goodOf(item.productId, links),
    qtyMilli: lineQtyMilli(item),
    unitPriceMinor: Number(item.unitPriceMinor) || 0,
    totalMinor: Math.max(0, Number(item.lineTotalMinor) || 0),
  }));
}

/** A Market sale.receipt as the restaurant receipt document (orderType "retail"). */
function receiptDocument(receipt, { cashierName = '', registerName = '' } = {}) {
  const items = (receipt.items || []).map((it, index) => {
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(it.unit_price_minor ?? it.unitPriceMinor) || 0;
    const gross = (Number(it.line_total_minor ?? it.lineTotalMinor) || 0) + (Number(it.discount_minor ?? it.discountMinor) || 0);
    // A scale line is qty 1 priced by weight: show the weight in the name.
    const weighed = qty === 1 && unit > 0 && Math.abs(gross - unit) > 1;
    const name = String(it.name || it.sku || 'Məhsul') + (weighed ? ` ${(gross / unit).toFixed(3)} ${it.unit || 'kq'}` : '');
    return {
      id: String(it.id ?? index), name, quantity: weighed ? 1 : qty,
      unitBasePriceMinor: weighed ? gross : unit, baseLineTotalMinor: gross, itemLineTotalMinor: gross,
    };
  });
  const subtotal = items.reduce((t, i) => t + i.itemLineTotalMinor, 0);
  const total = Number(receipt.totalMinor) || 0;
  const loyalty = Math.max(0, Number(receipt.loyaltyRedeemedMinor) || 0);
  const method = String(receipt.paymentMethod || 'cash');
  const card = Math.max(0, Number(receipt.cardMinor) || (method === 'card' ? total - loyalty : 0));
  const cash = Math.max(0, Number(receipt.cashMinor) || (method === 'cash' ? total - loyalty : 0));
  const credit = Math.max(0, total - cash - card - loyalty);
  const tendered = Number(receipt.tenderedMinor) || 0;
  const change = Math.max(0, Number(receipt.changeMinor) || 0);
  const payments = [];
  if (cash > 0) payments.push({ method: 'cash', label: 'Nağd', amountMinor: cash, tenderedMinor: Math.max(tendered, cash), changeMinor: change });
  if (card > 0) payments.push({ method: 'card', label: 'Kart', amountMinor: card });
  if (loyalty > 0) payments.push({ method: 'complimentary', label: 'Bonusdan', amountMinor: loyalty });
  if (credit > 0) payments.push({ method: 'complimentary', label: 'Nisyə', amountMinor: credit });
  const footer = [];
  const earned = Number(receipt.loyaltyEarnedMinor) || 0;
  if (receipt.customerName) footer.push(`Müştəri: ${receipt.customerName}`);
  if (earned > 0) footer.push(`Qazanılan bonus: ${(earned / 100).toFixed(2)} AZN`);
  if (earned > 0 || loyalty > 0) footer.push(`Bonus balansı: ${((Number(receipt.loyaltyBalanceMinor) || 0) / 100).toFixed(2)} AZN`);
  if (footer.length) footer.push('Təşəkkür edirik!');
  const store = String(receipt.storeName || '').replace(/^"|"$/g, '');
  return {
    kind: 'payment_receipt', orderType: 'retail',
    receiptId: String(receipt.receiptNo || ''), receiptNumber: String(receipt.receiptNo || ''),
    terminalName: registerName || String(receipt.registerId || ''), waiterName: cashierName,
    openedAt: Number(receipt.createdAt) || Date.now(), paidAt: Number(receipt.createdAt) || Date.now(),
    restaurant: { name: store },
    items, subtotalMinor: subtotal, discountTotalMinor: Math.max(0, subtotal - total), discountLabel: 'Endirim',
    grandTotalMinor: total, amountPaidMinor: total, changeAmountMinor: change, payments, footer,
  };
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
    if (this.core.state === 'ready' || this.core.state === 'starting') return;
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

  /**
   * The warehouse core's administrator: every call from Market acts as it.
   * The core seeds (and on every start revives) usr-admin; there is no user
   * list to ask - auth.listUsers is not a core method, which is what left
   * 1.5.0/1.5.1 with "Anbar sistemi hazır deyil".
   */
  async actor() {
    if (!this.admin) this.admin = { id: 'usr-admin', code: '9001' };
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
    if (!this.isHost() || this.core.state !== 'ready' || this.market.state !== 'ready') return;
    try { await this.importMarketProducts(); } catch (error) { console.error('[ops-import]', error?.message || error); }
    try { await this.feedSales(); } catch (error) { console.error('[ops-feed]', error?.message || error); }
    try { await this.syncCatalog(); } catch (error) { console.error('[ops-catalog]', error?.message || error); }
  }

  /**
   * A Market receipt in this shop's receipt design: printed by the warehouse
   * core when Parametrlər → Printer has a printer chosen ({ printed: true }),
   * otherwise the printer bytes for Market's own printer ({ bytes }).
   */
  async renderReceipt(receipt, names) {
    const res = await this.invoke('receipt.renderExternal', { document: receiptDocument(receipt, names), deliver: true }, { timeoutMs: 30000 });
    if (!res.success) throw new Error(res.error?.message || 'Çek hazırlanmadı');
    if (res.data?.printed) return { printed: true };
    if (!res.data?.bytes) throw new Error('Çek hazırlanmadı');
    return { printed: false, bytes: Buffer.from(String(res.data.bytes), 'base64') };
  }

  scheduleCatalog() {
    clearTimeout(this.catalogTimer);
    this.catalogTimer = setTimeout(() => { void this.syncCatalog().catch((error) => console.error('[ops-catalog]', error?.message || error)); }, 800);
  }

  async syncCatalog() {
    if (this.busy.catalog) { this.busy.again = true; return; }
    if (!this.isHost() || this.core.state !== 'ready' || this.market.state !== 'ready') return;
    // Until Market's own products are in Mallar and linked, a sync would double them.
    if (!this.settings().legacyImported) return;
    this.busy.catalog = true;
    try {
      const goodsRes = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
      if (!goodsRes.success) return;
      const listRes = await this.market.invoke('product.list', { activeOnly: false }, 60000);
      if (!listRes?.success || !Array.isArray(listRes.data)) return;
      const links = this.settings().links || {};
      const productOf = new Map(Object.entries(links).map(([productId, goodId]) => [goodId, productId]));
      const all = new Map(listRes.data.map((p) => [p.id, p]));
      // Products this bridge owns: ops-* and the Market products linked to a good.
      const existing = new Map(listRes.data.filter((p) => String(p.id).startsWith('ops-') || links[p.id]).map((p) => [p.id, p]));
      const seen = new Set();
      for (const good of goodsRes.data?.goods ?? []) {
        const productId = productOf.get(String(good.id)) || `ops-${good.id}`;
        const have = all.get(productId);
        const want = marketProduct(good, have, productId);
        seen.add(want.id);
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

  /**
   * Once, on the warehouse PC: Market's own products (and their stock) go into
   * Mallar, each linked to the product it came from - the selling screen keeps
   * the same products, sales history and images, and nothing is doubled.
   */
  async importMarketProducts() {
    if (this.settings().legacyImported || this.busy.importing) return;
    this.busy.importing = true;
    try {
      const listRes = await this.market.invoke('product.list', { activeOnly: true }, 60000);
      if (!listRes?.success || !Array.isArray(listRes.data)) return;
      const legacy = listRes.data.filter((p) => !String(p.id).startsWith('ops-') && p.kind !== 'service');
      const links = { ...(this.settings().links || {}) };
      if (legacy.length) {
        const unit = (u) => (u === 'kq' ? 'kg' : u === 'litr' ? 'l' : 'ədəd');
        const rows = legacy.map((p) => ({
          name: String(p.name?.az || p.sku || ''), barcode: String(p.barcode || ''), unit: unit(p.unit),
          costMinor: Math.max(0, Number(p.costMinor) || 0), salePriceMinor: Math.max(0, Number(p.priceMinor) || 0),
          category: String(p.category || ''),
        }));
        for (let i = 0; i < rows.length; i += 500) {
          const res = await this.invoke('goods.import', { rows: rows.slice(i, i + 500), updateExisting: true }, { timeoutMs: 120000 });
          if (!res.success) throw new Error(res.error?.message || 'goods.import');
        }
        const goodsRes = await this.invoke('goods.list', {}, { timeoutMs: 60000 });
        if (!goodsRes.success) throw new Error(goodsRes.error?.message || 'goods.list');
        const goods = goodsRes.data?.goods ?? [];
        const byBarcode = new Map(goods.filter((g) => g.barcode).map((g) => [String(g.barcode), g]));
        const byName = new Map(goods.map((g) => [String(g.name).toLocaleLowerCase('az'), g]));
        const taken = new Set(Object.values(links));
        for (const p of legacy) {
          const good = (p.barcode && byBarcode.get(String(p.barcode))) || byName.get(String(p.name?.az || '').toLocaleLowerCase('az'));
          if (!good || taken.has(String(good.id))) continue;
          links[p.id] = String(good.id);
          taken.add(String(good.id));
          const stock = Math.round((Number(p.stock) || 0) * 1000) - (Number(good.qtyMilli) || 0);
          if (stock > 0) {
            await this.invoke('inventory.adjust', { ingredientId: String(good.id), qtyDeltaMilli: stock, reason: 'Market qalığı (köçürmə)' },
              { idempotencyKey: `mkt-stock-${p.id}`, timeoutMs: 15000 });
          }
        }
      }
      // The stock imported is today's: sales already made must not come off it again.
      const fed = new Set(this.settings().fed || []);
      const sales = await this.market.invoke('sale.list', {}, 60000);
      for (const sale of Array.isArray(sales?.data) ? sales.data : []) {
        fed.add(sale.id);
        fed.add(`r:${sale.id}`);
        for (const refund of sale.refunds || []) fed.add(`r:${refund.refundId}`);
      }
      this.saveSettings({ links, legacyImported: true, fed: [...fed].slice(-4000) });
      console.log(`[ops-import] ${Object.keys(links).length} Market products linked to Mallar`);
    } finally {
      this.busy.importing = false;
    }
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
      const links = this.settings().links || {};
      const before = fed.size;
      for (const sale of res.data.slice().reverse()) {
        const terminal = { id: `market-${sale.registerId || 'kassa'}`, name: await this.registerName(String(sale.registerId || '')) };
        if (!fed.has(sale.id)) {
          if (!(await this.recordSale(sale, terminal, links))) continue;
          fed.add(sale.id);
        }
        const money = saleMoney(sale);
        const refundMoney = (amount) => money.card > 0 && money.cash === 0 ? { cardMinor: amount }
          : money.cash === 0 && money.card === 0 && money.credit > 0 ? { creditMinor: amount } : { cashMinor: amount };
        for (const refund of sale.refunds || []) {
          const key = `r:${refund.refundId}`;
          if (fed.has(key)) continue;
          const amount = (refund.lines || []).reduce((t, l) => t + (Number(l.amountMinor) || 0), 0);
          const lines = (refund.lines || []).filter((l) => goodOf(l.productId, links))
            .map((l) => ({ ingredientId: goodOf(l.productId, links), qtyMilli: (Number(l.qty) || 0) * 1000 }));
          if (await this.recordRefund(key, sale.id, lines, refundMoney(amount), refund.createdAt, terminal)) fed.add(key);
        }
        const full = `r:${sale.id}`;
        if (sale.refunded && !(sale.refunds || []).length && !fed.has(full)) {
          const lines = saleLines(sale.items, links).map((l) => ({ ingredientId: l.ingredientId, qtyMilli: l.qtyMilli }));
          if (await this.recordRefund(full, sale.id, lines, { cashMinor: money.cash, cardMinor: money.card, creditMinor: money.credit }, Date.now(), terminal)) fed.add(full);
        }
      }
      if (fed.size !== before) this.saveSettings({ fed: [...fed].slice(-4000) });
    } finally {
      this.busy.feed = false;
    }
  }

  async recordSale(sale, terminal, links) {
    const lines = saleLines(sale.items, links);
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
    // E_NOT_FOUND: the sale itself was never booked (nothing from Mallar on it),
    // so neither is its return.
    if (!res.success && res.error?.code === 'E_NOT_FOUND') return true;
    if (!res.success) console.error('[ops-feed] refund', externalId, res.error?.message);
    return res.success;
  }
}

module.exports = { OpsEngine, marketProduct, sameProduct, lineQtyMilli, saleMoney, saleLines, goodOf, receiptDocument, ok, fail };
