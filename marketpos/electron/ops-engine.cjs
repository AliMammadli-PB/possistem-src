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
const { syncRegisters, syncWarehouseLedger, refundTenders } = require('./register-bridge.cjs');
const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs');

const UNIT = { kg: 'kq', l: 'litr', 'ədəd': 'əd', qab: 'əd', q: 'kq' };
/** What a "warehouse" Market role may do in Əməliyyatlar; a manager may do all. */
const WAREHOUSE_METHODS = /^(categories|goods|stocktake|ingredients|inventory|warehouses|purchases|suppliers|supplierItems|lots|locations|replenish|stockRules|recipes)\.|^reports\.(expiry|suppliers|stockLoss)$|^permissions\.list$|^cashAccounts\.list$/;
const CATALOG_WRITES = /^(ingredients\.(save|deactivate)|goods\.(import|prices)|categories\.(save|delete)|purchases\.(save|confirm|receive|inspect|invoice|addCost|removeCost|update|delete|return|deleteReturn)|inventory\.(adjust|waste|costingMethod)|stocktake\.post|lots\.(relocate|writeOff|extend))$/;
const isCatalogWrite = (method) => CATALOG_WRITES.test(method);
// What a unit cost the branch (for the stock value across branches).
const costOf = (g) => Math.max(0, Math.round(Number(g.lastCostMinor ?? g.costMinor) || 0));
/** Calls that only read, for a user who may look at documents but not run the warehouse. */
const READ_METHODS = /\.(list|get|levels|movements|ledger|moves|returns|lowStock|valuation|getAll|printers)$|^permissions\.list$|^reports\./;

/**
 * Which documents (qaimələr) permission a warehouse call needs: looking at
 * them, changing a saved one, or deleting / cancelling one. A `save` with an
 * id rewrites an existing document, so it is an edit.
 */
const DOC_VIEW = /^(purchases\.(list|get|returns)|sales\.(list|get)|income\.list|stocktake\.(list|get)|cash\.list|cashAccounts\.moves|inventory\.movements)$/;
const DOC_EDIT = /^(purchases\.(update|addCost|removeCost)|sales\.update|stocktake\.update)$/;
const DOC_DELETE = /^(purchases\.(delete|deleteReturn)|sales\.delete|income\.delete|stocktake\.cancel)$/;
function docPermission(method, payload) {
  if(method==='business.call'){const a=payload?.action||'';if(a==='documents'||a==='document.get'||a==='transfer.list'||a==='transfer.get')return 'DOCS_VIEW';if(a==='correct')return payload?.cancel?'DOCS_DELETE':'DOCS_EDIT';if(a==='transfer.save')return Number(payload?.revision)>0?'DOCS_EDIT':'DOCS_CREATE';if(a==='transfer.cancel'||a==='transfer.recall'||a==='transfer.revoke'||a==='waste.delete')return 'DOCS_DELETE';if(a==='waste.list'||a==='waste.get')return 'DOCS_VIEW';if(a==='waste.save')return payload?.id?'DOCS_EDIT':'DOCS_CREATE';if(a==='transfer.reverse')return 'DOCS_CREATE';}

  if (DOC_DELETE.test(method)) return 'DOCS_DELETE';
  if (DOC_EDIT.test(method) || (/^(purchases|income)\.save$/.test(method) && payload?.id)) return 'DOCS_EDIT';
  if (/^(purchases\.(save|return)|income\.save|salary\.pay|customers\.payDebt|suppliers\.pay|cash\.movement|stocktake\.create)$/.test(method)) return 'DOCS_CREATE';
  if (DOC_VIEW.test(method)) return 'DOCS_VIEW';
  return '';
}

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
  const exact = Number(item.qtyMilli ?? item.qty_milli);
  if (Number.isSafeInteger(exact) && exact > 0) return exact;
  const qty = Math.max(0, Number(item.qty) || 0);
  const unitPrice = Number(item.unitPriceMinor) || 0;
  const gross = (Number(item.lineTotalMinor) || 0) + (Number(item.discountMinor) || 0);
  if (qty === 1 && unitPrice > 0 && Math.abs(gross - unitPrice) > 1) return Math.max(1, Math.round((gross * 1000) / unitPrice));
  return qty * 1000;
}

/** Restore the original sold weight, never one kilogram per weighed package.
 * Native refund rows keep the sale-item identity, including duplicate products. */
function refundQtyMilli(line, items = []) {
  const matches = line.saleItemId != null
    ? items.filter(item => String(item.saleItemId) === String(line.saleItemId))
    : items.filter(item => item.productId === line.productId);
  const count = matches.reduce((sum,item) => sum + Math.max(0,Number(item.qty)||0),0);
  const weight = matches.reduce((sum,item) => sum + lineQtyMilli(item),0);
  return count > 0 ? Math.round(weight * Math.max(0,Number(line.qty)||0) / count) : Math.max(0,Number(line.qty)||0)*1000;
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

/** True when a receipt is older than its product's place in Mallar (its stock came in already net of it). */
function stockBefore(productId, at, linkedAt = {}) {
  const id = String(productId || '');
  if (id.startsWith('ops-')) return false;
  const since = Number(linkedAt[id]) || 0;
  return since > 0 && (Number(at) || 0) < since;
}

/** The warehouse lines of a sale (products with no good in Mallar are skipped). */
function saleLines(items, links = {}) {
  return (items || []).filter((item) => goodOf(item.productId, links)).map((item) => ({
    productId: String(item.productId || ''),
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
    const exactWeight = Number(it.qtyMilli ?? it.qty_milli);
    const weighed = exactWeight > 0 || qty === 1 && unit > 0 && Math.abs(gross - unit) > 1;
    const name = String(it.name || it.sku || 'Məhsul') + (weighed ? ` ${(exactWeight > 0 ? exactWeight / 1000 : gross / unit).toFixed(3)} ${it.unit || 'kq'}` : '');
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
    kind: 'payment_receipt', orderType: 'retail', isReprint: receipt.isReprint === true,
    receiptId: String(receipt.receiptNo || ''), receiptNumber: String(receipt.receiptNo || ''),
    returnLookupCode: String(receipt.receiptNo || '').match(/\d+$/)?.[0] || String(receipt.receiptNo || ''),
    terminalName: registerName || String(receipt.registerId || ''), waiterName: cashierName,
    openedAt: Number(receipt.createdAt) || Date.now(), paidAt: Number(receipt.createdAt) || Date.now(),
    restaurant: { name: store },
    items, subtotalMinor: subtotal, discountTotalMinor: Math.max(0, subtotal - total), discountLabel: 'Endirim',
    grandTotalMinor: total, amountPaidMinor: total, changeAmountMinor: change, payments, footer,
  };
}

/** Warehouse screen permission -> the Market rights that open it (any one). */
const OPS_RIGHTS = {
  'inventory.view': ['OPS_GOODS','OPS_STOCK','OPS_CATEGORIES','OPS_STOCKTAKE','EDIT_STOCK', 'STOCK_ADJUSTMENT', 'RECEIVE_PURCHASE', 'TRANSFER_STOCK', 'CREATE_PRODUCT', 'EDIT_PRODUCT', 'EDIT_PRICE', 'VIEW_COST', 'DOCS_VIEW'],
  'inventory.manage': ['EDIT_STOCK', 'CREATE_PRODUCT', 'EDIT_PRODUCT'],
  'inventory.adjust': ['STOCK_ADJUSTMENT', 'EDIT_STOCK'],
  'inventory.count': ['OPS_STOCKTAKE','STOCK_ADJUSTMENT'],
  'inventory.transfer': ['TRANSFER_STOCK'],
  'catalog.manage': ['CREATE_PRODUCT', 'EDIT_PRODUCT'],
  'recipes.manage': ['EDIT_PRODUCT'],
  'suppliers.view': ['OPS_PURCHASES','OPS_PARTNERS','RECEIVE_PURCHASE', 'DOCS_VIEW'],
  'suppliers.receive': ['RECEIVE_PURCHASE'],
  'suppliers.manage': ['RECEIVE_PURCHASE'],
  'suppliers.pay': ['CASH_OUT'],
  'purchases.edit': ['RECEIVE_PURCHASE', 'DOCS_EDIT'],
  'purchases.delete': ['DOCS_DELETE'],
  'customers.view': ['OPS_PARTNERS','VIEW_REPORTS', 'RECEIVE_PURCHASE'],
  'customers.credit': ['VIEW_REPORTS'],
  'sales.view': ['OPS_SALES','VIEW_REPORTS'],
  'sales.edit': ['SALE_REFUND'],
  'sales.delete': ['SALE_CANCEL'],
  'payment.refund': ['SALE_REFUND'],
  'cash.manage': ['OPS_CASH','OPS_EXPENSES','OPS_PROFIT','CASH_IN', 'CASH_OUT', 'SAFE_DROP', 'CLOSE_SHIFT'],
  'cash.accounts': ['OPS_CASH','CASH_IN', 'CASH_OUT', 'SAFE_DROP'],
  'salary.manage': ['OPS_SALARY','MANAGE_USERS'],
  'reports.view': ['OPS_PROFIT','OPS_EXPORT','VIEW_REPORTS'],
  'reports.x': ['VIEW_REPORTS'],
  'reports.z': ['CLOSE_SHIFT'],
  'reports.export': ['OPS_EXPORT','VIEW_REPORTS'],
  'users.manage': ['OPS_USERS','MANAGE_USERS'],
  'settings.manage': ['MANAGE_SETTINGS'],
};

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
    this.reconcilePromise = null;
    this.catalogError = null;
  }

  /**
   * One file per customer account: links, the import flag, categories and the
   * branch belong to a customer's warehouse. A shared file let a PC activated
   * for a second customer skip its import and show the first one's categories.
   */
  settingsFile() {
    const dir = require('electron').app.getPath('userData');
    const id = String(this.customerId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(dir, id ? `market-ops-${id}.json` : 'market-ops.json');
  }
  /** The first start of a customer adopts the old shared file, once - existing shops lose nothing. */
  adoptSharedSettings() {
    if (!this.customerId) return;
    const dir = require('electron').app.getPath('userData');
    const shared = path.join(dir, 'market-ops.json'), mine = this.settingsFile();
    try {
      if (existsSync(mine) || !existsSync(shared)) return;
      writeFileSync(mine, readFileSync(shared, 'utf8'), 'utf8');
      renameSync(shared, `${shared}.adopted-${String(this.customerId).replace(/[^a-zA-Z0-9_-]/g, '')}`);
    } catch (error) { console.error('[ops-settings]', error?.message || error); }
  }
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
    this.customerId = customerId || '';
    this.adoptSharedSettings();
    await this.core.start(customerId);
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick(), 15000);
    this.timer.unref?.();
    void this.tick();
  }
  async stop() {
    clearInterval(this.timer);
    clearTimeout(this.catalogTimer); this.catalogTimer = null;
    this.timer = null;
    await this.core.stop();
  }
  status() {
    const settings = this.settings();
    return { host: this.isHost(), state: this.core.state, available: Boolean(this.core.resolveCorePath()), catalogPending: Boolean(this.reconcilePromise || this.catalogTimer), catalogError: this.catalogError,
      // What did not reach the warehouse and why, for the Əməliyyatlar screen.
      parked: Object.entries(settings.parked || {}).slice(-20).map(([key, row]) => ({ key, error: row?.error || '', at: row?.at || 0 })),
      linked: Object.keys(settings.links || {}).length, errors: this.syncErrors || {} };
  }

  /** The method list the screens may call (built next to them as ops/methods.json). */
  allowed(method, role, docsOnly = false, payload = {}) {
    if (!this.methods) {
      try { this.methods = new Set(JSON.parse(readFileSync(path.join(__dirname, '..', 'dist', 'ops', 'methods.json'), 'utf8'))); }
      catch { this.methods = new Set(); }
    }
    if (!this.methods.has(method)||method==='inventory.transfer') return false;
    // Market logins live in secure staff state, never in the Restaurant payroll API.
    if(method==='business.call'&&['staff.save','staff.link'].includes(payload.action))return false;
    if(method==='business.call'&&String(payload.action||'').startsWith('transfer.'))return !['transfer.sync','transfer.outbox','transfer.ack','transfer.failure'].includes(payload.action);
    // A document-rights user (not a storekeeper): reads, and the document calls
    // whose own right main checks next.
    // (A `save` counts only with an id: rewriting a saved document, not making one.)
    const doc = Boolean(docPermission(method, payload));
    if (docsOnly) return Boolean(doc) || ['cashAccounts.list','customers.list','suppliers.list','permissions.list'].includes(method);
    return role === 'manager' || WAREHOUSE_METHODS.test(method) || doc;
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

  async invoke(method, payload, options = {}) {
    const { terminal, idempotencyKey, timeoutMs } = options;
    if (this.core.state !== 'ready') return fail('E_CORE_DOWN', 'Anbar sistemi hazır deyil');
    const transferAction = method === 'business.call' ? payload?.action : '';
    if (transferAction === 'transfer.dispatch') {
      try { await this.salesBarrier(); } catch (e) { return fail('E_SALES_PENDING', e?.message || String(e)); }
    }
    // A recall never runs while the relay may be handing this very dispatch over.
    if (transferAction === 'transfer.recall' && !options.relayHeld) {
      while (this.transferBusy) await new Promise((r) => setTimeout(r, 100));
      this.transferBusy = true;
      try { return await this.invoke(method, payload, { ...options, relayHeld: true }); } finally { this.transferBusy = false; }
    }
    const admin = await this.actor();
    if (!admin) return fail('E_NO_ADMIN', 'Anbar sistemində administrator tapılmadı');
    if (method === 'cashAccounts.deactivate') {
      try {
        await this.flushCatalog({ timeoutMs: 10000 });
        const accounts = await this.core.invoke('cashAccounts.list', {}, { actor: {userId:admin.id}, timeoutMs:8000 });
        if (!accounts.success) return accounts;
        const account = accounts.data.accounts.find(a => a.id === payload?.accountId);
        if (account?.terminalId?.startsWith('market-')) {
          if (Number(account.balanceMinor) !== 0) return fail('E_VALIDATION','Kassada pul var — əvvəlcə transfer edin');
          const archived = await this.market.invoke('cash.archiveRegister', {id:account.terminalId.slice(7),actorId:'system'}, 10000);
          if (!archived.success) return archived;
          payload = {...payload,marketArchived:true};
        }
      } catch (e) { return fail('E_CASH_ARCHIVE',e.message||String(e)); }
    }
    const res = await this.core.invoke(method, payload ?? {}, {
      actor: { userId: admin.id }, terminal: terminal || { id: 'market-ops', name: 'Market' }, idempotencyKey, timeoutMs: timeoutMs || 15000,
    });
    // A Zay document or a revoked transfer moves stock through business.call (1.5.47).
    if (res?.success && (isCatalogWrite(method) || (method === 'business.call' && ['waste.save', 'waste.delete', 'transfer.revoke'].includes(payload?.action)))) this.scheduleCatalog();
    if (res?.success && /^(ingredients\.(save|deactivate)|goods\.(import|prices))$/.test(method)) this.scheduleScale();
    return { success: Boolean(res?.success), data: res?.data ?? null, error: res?.error ?? null };
  }

  /**
   * What the screens are allowed to show this Market user: each warehouse
   * screen right follows the Market rights POSSISTEM gave (role or worker), so
   * a button the user may not use is not there. POSSISTEM's own user sees all.
   */
  async session(staff, rights = null) {
    const admin = await this.actor();
    if (!admin) throw new Error('Anbar sistemi hazır deyil');
    const perms = await this.invoke('permissions.list', {}, { timeoutMs: 8000 });
    // 1.5.66: a warehouse that is not running answered with an empty rights list, and the remote
    // screen said "Bu bölmələr üçün səlahiyyətiniz yoxdur" to the owner. Say what is wrong instead.
    if (!perms.success) return perms;
    let keys = [];
    if (perms.success) for (const list of Object.values(perms.data?.groups || {})) for (const p of Array.isArray(list) ? list : []) if (p?.key) keys.push(String(p.key));
    if (Array.isArray(rights)) {
      if (!rights.includes('SUPER_ADMIN')) keys = keys.filter((k) => (OPS_RIGHTS[k] || []).some((r) => rights.includes(r)));
    } else if (staff.role !== 'manager') keys = keys.filter((k) => /^(inventory|suppliers|recipes)\./.test(k));
    return ok({ primaryWarehouseId: this.settings().primaryOpsWarehouse || '', userId: admin.id, code: admin.code, fullName: staff.name, canPaymentDocuments: Array.isArray(rights) ? rights.some((r) => r === 'SUPER_ADMIN' || r.startsWith('DOCS_')) : staff.role === 'manager', role: 'administrator', shiftId: null, permissions: keys, loginAt: Date.now(), authenticated: true });
  }

  async tick() {
    void this.flushTransfers().catch(error=>console.error('[transfer-relay]',error.message));
    try { await this.reconcile(); }
    catch (error) { console.error('[ops-sync]', error?.message || error); }
  }

  // Sales must reach the warehouse before its quantity is copied back to the till.
  // All polling and explicit writes share this barrier, including a write that
  // arrives while an older catalog snapshot is still being copied.
  reconcile() {
    if (!this.isHost() || this.core.state !== 'ready' || this.market.state !== 'ready') return Promise.resolve();
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = (async () => {
      // Each step on its own: a failed one-time import or a kassa error used to
      // stop products, sales and kassas reaching the warehouse altogether.
      const errors = {};
      const step = async (name, run) => {
        try { return await run(); }
        catch (error) { errors[name] = error?.message || String(error); console.error(`[ops-sync] ${name}`, errors[name]); return undefined; }
      };
      do {
        this.reconcileAgain = false;
        await step('demo', () => this.purgeDemoCatalog());
        await step('import', () => this.importMarketProducts());
        await step('kassalar', () => this.syncRegisters());
        // Every product a receipt names must be a good before the receipt is booked.
        await step('işçilər',()=>this.syncStaff());
        await step('partnyorlar', () => this.syncCustomers());
        await step('mallar', () => this.linkCatalogStrays());
        const fed = await step('satışlar', () => this.feedSales());
        if (fed === false) errors['satışlar'] = errors['satışlar'] || 'Bəzi satışlar Anbara yazılmadı';
        await step('kassa hərəkətləri', () => this.syncWarehouseLedger());
        // Quantities come back to the till only once its sales are in the warehouse.
        if (fed !== false && !errors['satışlar']) await step('qalıqlar', () => this.syncCatalog());
      } while (this.reconcileAgain);
      this.syncErrors = errors;
      const first = Object.entries(errors)[0];
      this.catalogError = first ? `${first[0]}: ${first[1]}` : null;
      // Every step has run; the caller still learns the pass was not clean.
      if (first) throw new Error(this.catalogError);
      this.catalogSyncedAt = Date.now();
    })().catch((error) => { this.catalogError = error?.message || String(error); throw error; })
      .finally(() => { this.reconcilePromise = null; });
    return this.reconcilePromise;
  }

  flushCatalog({ timeoutMs = 0 } = {}) {
    clearTimeout(this.catalogTimer); this.catalogTimer = null;
    if (this.isHost() && (this.core.state !== 'ready' || this.market.state !== 'ready')) {
      this.catalogError = 'Anbar–kassa bağlantısı hazır deyil';
      return Promise.reject(new Error(this.catalogError));
    }
    const pending = this.reconcile();
    if (!(timeoutMs > 0)) return pending;
    // Do not cancel a committed write or its background mirror. The UI can
    // finish and report pending sync while a large initial catalog catches up.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Anbar–kassa yenilənməsi davam edir')), timeoutMs);
      pending.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }

  /**
   * A Market receipt in this shop's receipt design: printed by the warehouse
   * core when Parametrlər → Printer has a printer chosen ({ printed: true }),
   * otherwise the printer bytes for Market's own printer ({ bytes }).
   */
  async renderReceipt(receipt, names) {
    // Bytes only. The till printer prints them. deliver:true made the cashier
    // wait on the warehouse core's own printer, which stalled the receipt.
    const res = await this.invoke('receipt.renderExternal', { document: receiptDocument(receipt, names), deliver: false }, { timeoutMs: 4000 });
    if (!res.success) throw new Error(res.error?.message || 'Çek hazırlanmadı');
    if (res.data?.printed) return { printed: true };
    if (!res.data?.bytes) throw new Error('Çek hazırlanmadı');
    return { printed: false, bytes: Buffer.from(String(res.data.bytes), 'base64') };
  }

  /** Top-level warehouse categories for the selling screen (host only; others show their goods' categories). */
  saleCategories() { return this.isHost() ? (this.settings().categories || []) : []; }

  /**
   * LAN label scale (1.5.51): a good's name, price or PLU change reaches the scale saved in
   * Mallar → Tərəziyə çıxış within a few seconds; unchanged goods are not resent.
   */
  scheduleScale() {
    if (!this.settings().scaleLan?.auto || !this.settings().scaleLan?.ip) return;
    clearTimeout(this.scaleTimer);
    this.scaleTimer = setTimeout(() => { this.scaleTimer = null; this.scaleSync().catch((e) => console.error('[scale]', e.message || e)); }, 3000);
  }
  /** Sends every weighed good with a PLU to the saved scale; `force` resends unchanged goods. */
  async scaleSync({ force = false } = {}) {
    const lan = require('./scale-lan.cjs');
    const cfg = this.settings().scaleLan || {};
    if (!cfg.ip) throw new Error('Tərəzinin IP ünvanı yazılmayıb');
    const goods = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
    if (!goods.success) throw new Error(goods.error?.message || 'Mallar oxunmadı');
    const { lines, names, skipped } = lan.scaleLines(goods.data?.goods ?? [], cfg.prefix, { labelNo: cfg.labelNo });
    if (!lines.length) throw new Error('Çəkili və PLU-su olan mal yoxdur');
    const sig = require('node:crypto').createHash('sha1').update(cfg.ip + lines.join('\n')).digest('hex');
    if (!force && sig === cfg.sig) return { sent: 0, total: lines.length, skipped, unchanged: true };
    try {
      const res = await lan.sendLines(cfg.ip, lines);
      const refused = res.rejected.map((i) => names[i]);
      const last = `${new Date().toLocaleString('az-AZ')}: ${res.accepted} mal tərəzidə yazıldı` + (refused.length ? `, ${refused.length} mal rədd edildi: ${refused.slice(0, 5).join(', ')}` : '');
      // A refused good is retried on the next change instead of being marked as sent.
      this.saveSettings({ scaleLan: { ...this.settings().scaleLan, sig: refused.length ? '' : sig, last } });
      return { sent: res.accepted, total: lines.length, skipped, refused, reply: res.reply };
    } catch (error) {
      this.saveSettings({ scaleLan: { ...this.settings().scaleLan, last: `${new Date().toLocaleString('az-AZ')}: ${error.message}` } });
      throw error;
    }
  }

  scheduleCatalog() {
    this.stockCache = null;
    // Only a successful mutation invalidates the snapshot being copied. Polls
    // and concurrent reads merely join it; otherwise a slow pass never ends.
    clearTimeout(this.catalogTimer);
    if (this.reconcilePromise) { this.reconcileAgain = true; this.catalogTimer = null; return; }
    this.catalogTimer = setTimeout(() => { this.catalogTimer = null; void this.tick(); }, 200);
  }

  /**
   * This branch's warehouse as the website and the other branches see it
   * (1.5.41): every good with its quantity in each warehouse. Only the
   * warehouse PC has it; null elsewhere or while the warehouse is starting.
   */
  // The branch-stock screen polls and the cloud sync runs alongside it: one warehouse
  // scan serves both for 15 s (every write schedules the catalog, which drops it).
  async stockSnapshot() {
    if (this.stockCache && Date.now() - this.stockCache.at < 15000) return this.stockCache.value;
    this.stockCache = null;
    const value = await this.stockSnapshotNow();
    if (value) this.stockCache = { at: Date.now(), value };
    return value;
  }

  async stockSnapshotNow() {
    if (!this.isHost() || this.core.state !== 'ready') return null;
    const snapshot = await this.invoke('business.call', { action: 'stock.snapshot' }, { timeoutMs: 60000 });
    const goods = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
    if (!snapshot.success || !goods.success) return null;
    const warehouses = (snapshot.data.warehouses || []).map((w) => ({ id: String(w.id), name: String(w.name || w.id).slice(0, 120) }));
    const good = new Map((goods.data?.goods ?? []).map((g) => [String(g.id), g]));
    const lines = [];
    for (const row of snapshot.data.levels || []) {
      const g = good.get(String(row.ingredientId));
      if (!g) continue;
      lines.push({ goodId: String(g.id), name: String(g.name || '').slice(0, 200), barcode: String(g.barcode || '').slice(0, 64), unit: String(g.unit || '').slice(0, 16),
        warehouseId: String(row.warehouseId), qtyMilli: Math.round(Number(row.qtyMilli) || 0), salePriceMinor: Math.max(0, Math.round(Number(g.salePriceMinor) || 0)), costMinor: costOf(g) });
    }
    // A good with no stock row yet is still one the branch carries.
    const stocked = new Set(lines.map((l) => l.goodId));
    for (const g of good.values()) if (!stocked.has(String(g.id)) && warehouses[0]) lines.push({ goodId: String(g.id), name: String(g.name || '').slice(0, 200), barcode: String(g.barcode || '').slice(0, 64), unit: String(g.unit || '').slice(0, 16), warehouseId: warehouses[0].id, qtyMilli: 0, salePriceMinor: Math.max(0, Math.round(Number(g.salePriceMinor) || 0)), costMinor: costOf(g) });
    // This branch's kassalar for the other branches' Kassalar tab (1.5.47).
    const cash = await this.invoke('cashAccounts.list', {}, { timeoutMs: 30000 }).catch(() => null);
    const registers = (cash?.success ? cash.data?.accounts || [] : []).filter((a) => a.kind === 'till').slice(0, 200)
      .map((a) => ({ id: String(a.id).slice(0, 80), name: String(a.name || '').slice(0, 120), balanceMinor: Math.round(Number(a.balanceMinor) || 0), todayCashMinor: Math.round(Number(a.todayCashMinor) || 0), todayCardMinor: Math.round(Number(a.todayCardMinor) || 0) }));
    // objectId: prices are per object, so an edit queued for this branch names it.
    return { updatedAt: Date.now(), objectId: String(await this.branchObject() || ''), warehouses, lines: lines.slice(0, 60000), registers };
  }

  async syncCatalog() {
    if (this.busy.catalog) { this.busy.again = true; return; }
    if (!this.isHost() || this.core.state !== 'ready' || this.market.state !== 'ready') return;
    // Until Market's own products are in Mallar and linked, a sync would double them.
    if (!this.settings().legacyImported) return;
    this.linkedAt();
    this.busy.catalog = true;
    try {
      const snapshot=await this.invoke('business.call',{action:'stock.snapshot'});if(!snapshot.success)throw Error(snapshot.error?.message||'Anbar qalıqları alınmadı');
      const ws=snapshot.data.warehouses||[];const primaryOps=this.settings().primaryOpsWarehouse||ws.find(w=>w.id==='wh-main')?.id||ws[0]?.id;
      if(primaryOps&&!this.settings().primaryOpsWarehouse)this.saveSettings({primaryOpsWarehouse:primaryOps});
      const settingResult=await this.market.invoke('settings.get',{});const currentWarehouse=settingResult.success?settingResult.data.defaultWarehouseId:'';
      const primaryMarket=this.settings().primaryMarketWarehouse||currentWarehouse||'wh-sales';if(!this.settings().primaryMarketWarehouse)this.saveSettings({primaryMarketWarehouse:primaryMarket});
      const selectedOps=currentWarehouse===primaryMarket?primaryOps:currentWarehouse.startsWith('ops-wh-')?currentWarehouse.slice(7):primaryOps;
      const stockOfGood=new Map();for(const row of snapshot.data.levels||[]){if(!stockOfGood.has(row.ingredientId))stockOfGood.set(row.ingredientId,{});stockOfGood.get(row.ingredientId)[row.warehouseId]=Math.floor(Math.max(0,Number(row.qtyMilli)||0)/1000);}
      const goodsRes = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
      if (!goodsRes.success) throw new Error(goodsRes.error?.message || 'Warehouse catalog unavailable');
      const listRes = await this.market.invoke('product.list', { activeOnly: false }, 60000);
      if (!listRes?.success || !Array.isArray(listRes.data)) throw new Error(listRes?.error?.message || 'Till catalog unavailable');
      // Every product the till sells must be a good in Anbar / Kateqoriyalar. A
      // product that missed the one-time import, or came from the portal or a
      // peer, is linked here (or brought into Mallar) on the next pass.
      if (await this.linkStrays(listRes.data, goodsRes.data?.goods ?? [])) return this.scheduleCatalog();
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
        want.stock=(stockOfGood.get(good.id)||{})[selectedOps]||0;
        want.stockByWarehouse=ws.map(w=>({id:w.id===primaryOps?primaryMarket:'ops-wh-'+w.id,name:w.name,qty:(stockOfGood.get(good.id)||{})[w.id]||0}));
        seen.add(want.id);
        if (have && sameProduct(have, want) && want.stockByWarehouse.every(w=>Number(have.warehouseStock?.[w.id]||0)===w.qty)) continue;
        const res = await this.market.invoke(have ? 'product.update' : 'product.create', { product: want, actorId: 'system' }, 15000);
        // One product the till rejects (e.g. a clashing SKU) must not keep every
        // other product's quantity from reaching it.
        if (!res?.success) console.error('[ops-catalog]', want.sku, res?.error?.message);
      }
      // Kateqoriyalar: the selling screen shows every top-level category, even one
      // with no goods yet, in the order it has in the warehouse.
      const cats = await this.invoke('categories.list', {}, { timeoutMs: 15000 });
      if (cats.success) {
        const rows = Array.isArray(cats.data) ? cats.data : cats.data?.categories ?? [];
        const names = rows.filter((c) => !c.parentId).map((c) => String(c.name || '').trim()).filter(Boolean);
        if (JSON.stringify(names) !== JSON.stringify(this.settings().categories || [])) this.saveSettings({ categories: names });
      }
      for (const [id, have] of existing) {
        if (seen.has(id) || !have.active) continue;
        const res = await this.market.invoke('product.update', { product: { ...have, active: false }, actorId: 'system' }, 15000);
        if (!res?.success) console.error('[ops-catalog] deactivate', id, res?.error?.message);
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
  // Login users and payroll partners are independent. Never overwrite legacy salary cards.
  async syncOwnerObject(){
    const owner=this.ownerObject?.();if(!owner?.branchId||!owner?.name||this.core.state!=='ready')return;
    const register=this.cashCurrentRegisterId||'';
    const stamp=JSON.stringify([owner.branchId,owner.name,register]);if(this.cloudObjectStamp===stamp)return;
    const wh=await this.invoke('warehouses.list',{});if(!wh.success)throw Error(wh.error?.message);
    const stores=wh.data.warehouses||[],warehouse=this.settings().primaryOpsWarehouse||stores.find(w=>w.id==='wh-main')?.id||stores[0]?.id;
    const result=await this.invoke('cashObjects.ensureMarket',{branchId:owner.branchId,name:owner.name,terminalId:register?'market-'+register:'',warehouseId:warehouse||''});if(!result.success)throw Error(result.error?.message);
    this.saveSettings({cloudObjectLinks:{...(this.settings().cloudObjectLinks||{}),[owner.branchId]:result.data.id}});this.cloudObjectStamp=stamp;
  }
  async syncStaff() {}
  async syncCustomers(){
    const exported=await this.market.invoke('customer.bridge',{action:'export'},15000);if(!exported.success)throw Error(exported.error?.message||'Partnyorlar alınmadı');
    const seen=this.settings().customerProfiles||{};const signature=c=>JSON.stringify([c.name,c.phone||'',Boolean(c.creditAllowed),Number(c.creditLimitMinor)||0]);
    const changed=exported.data.customers.filter(c=>seen[c.id]!==signature(c)).map(c=>({...c,creditAllowed:Boolean(c.creditAllowed)}));
    const sent=await this.invoke('business.call',{action:'party.import',customers:changed,events:exported.data.events||[]});if(!sent.success)throw Error(sent.error?.message||'Partnyor borcu ötürülmədi');
    const ack=await this.market.invoke('customer.bridge',{action:'ack',ids:sent.data.ids||[]});if(!ack.success)throw Error(ack.error?.message||'Partnyor təsdiqi alınmadı');
    const fresh=await this.invoke('business.call',{action:'party.snapshot'});if(!fresh.success)throw Error(fresh.error?.message||'Partnyorlar alınmadı');
    const customers=(fresh.data.customers||[]).map(c=>({...c,creditAllowed:Boolean(c.creditAllowed)}));const imported=await this.market.invoke('customer.bridge',{action:'import',customers});if(!imported.success)throw Error(imported.error?.message||'Partnyorlar yenilənmədi');
    this.saveSettings({customerProfiles:Object.fromEntries(customers.map(c=>[c.id,signature(c)]))});
  }
  // A till sale not yet booked in the warehouse must not leave in a transfer:
  // the stock would go negative once that sale arrives.
  async salesBarrier() {
    if (!this.isHost()) return;
    if (this.market.state !== 'ready') throw new Error('Kassa sistemi hazır deyil: satışlar Anbara yazılmadan göndərmək olmaz');
    let complete;
    while ((complete = await this.feedSales()) === undefined) await new Promise((r) => setTimeout(r, 100));
    if (complete === false) throw new Error('Kassanın bəzi satışları hələ Anbara yazılmayıb. Bir azdan yenidən göndərin');
  }
  async flushTransfers() {
    if(!this.transferTransport || this.transferBusy || this.core.state!=='ready')return;
    this.transferBusy=true;
    try{const result=await this.invoke('business.call',{action:'transfer.outbox'});if(!result.success)return;
      // Each event on its own: a refused or unreachable one backs off (its reason
      // shows on the document) without holding up any other transfer.
      const retry=this.transferRetry||(this.transferRetry=new Map()),held=new Set();
      for(const event of result.data.events||[]){
        if(held.has(event.transferId)||(retry.get(event.id)||0)>Date.now()){held.add(event.transferId);continue;}
        try{await this.transferTransport(event);const ack=await this.invoke('business.call',{action:'transfer.ack',eventId:event.id});if(ack.success)retry.delete(event.id);else held.add(event.transferId);}
        catch(error){held.add(event.transferId);retry.set(event.id,Date.now()+Math.min(600000,15000*2**Math.min(Number(event.attempts)||0,6)));
          await this.invoke('business.call',{action:'transfer.failure',eventId:event.id,error:error?.message||String(error),rejected:Boolean(error?.rejected)}).catch(()=>{});}
      }
    }finally{this.transferBusy=false;}
  }

  async remoteBatch({calls,expiresAt}) {
    if(!this.isHost())throw Error('Bu kassa anbar kompüteri deyil. Filialın əsas kassasını seçin');
    const {kind}=require('./cloud-branches.cjs');
    if(!Number.isFinite(expiresAt)||expiresAt<Date.now()||!Array.isArray(calls)||calls.length>16)throw Error('Filial sorğusunun vaxtı bitib');
    const transferOnly=calls.every(call=>call.method==='business.call'&&String(call.payload?.action||'').startsWith('transfer.'));
    // Read pages share the committed mirror. Only dirty, failed, initial or stale
    // snapshots need the barrier; a session/permission poll never scans the catalog.
    const needsCatalog=calls.some(call=>call.method!=='__session')&&!transferOnly;
    if(needsCatalog&&(this.catalogTimer||this.reconcilePromise||this.catalogError||Date.now()-(this.catalogSyncedAt||0)>=15000))await this.flushCatalog({timeoutMs:10000});
    const results=[];
    for(const call of calls){
      if(call.method==='business.call'&&['staff.save','staff.link'].includes(call.payload?.action)){results.push(fail('E_FORBIDDEN','Giriş istifadəçilərini İstifadəçilər, maaş kartlarını Partnyorlar bölməsindən idarə edin'));continue;}
      const mode=kind(call);
      if(!mode || Date.now()>expiresAt){results.push(fail('E_FORBIDDEN','Əməliyyata icazə yoxdur və ya sorğunun vaxtı bitib'));continue;}
      if(call.method==='__session'){results.push(await this.session({name:'Filial müdiri',role:'manager'}));continue;}
      const payload={...(call.payload||{})};if(call.method==='business.call'&&payload.action==='transfer.save')payload.fromDeviceId=this.ownerObject?.()?.deviceId||'';
      const result=await this.invoke(call.method,payload,{terminal:{id:this.cashCurrentRegisterId?'market-'+this.cashCurrentRegisterId:'branch-remote',name:'Filial müdiri'},idempotencyKey:call.idempotencyKey,timeoutMs:30000});
      if(result.success && mode==='w'){this.scheduleCatalog();void this.flushTransfers();if(!transferOnly)try{await this.flushCatalog({timeoutMs:5000});}catch{result.syncWarning=true;}}
      results.push(result);
    }
    return {z:require('node:zlib').deflateRawSync(Buffer.from(JSON.stringify(results))).toString('base64')};
  }

  async branchContext() {
    const snapshot = await this.market.invoke('cash.bridgeSnapshot', { actorId: 'system' }, 8000);
    if (!snapshot.success) throw new Error('Kassa məlumatı alınmadı');
    const registerId = snapshot.data.defaultRegisterId;
    const listed = await this.invoke('cashAccounts.list', {}, { timeoutMs: 8000 });
    if (!listed.success) throw new Error('Filial məlumatı alınmadı');
    const account = (listed.data.accounts || []).find(a => a.kind === 'till' && a.terminalId === `market-${registerId}`);
    const object = (listed.data.objects || []).find(o => o.id === account?.objectId);
    return { registerId, branchName: object?.name || account?.objectName || '', objectId: account?.objectId || '' };
  }

  async branchObject() {
    if (this.settings().objectId) return this.settings().objectId;
    const now = Date.now();
    const res = await this.invoke('cashAccounts.list', { from: now - 864e5, to: now + 864e5 }, { timeoutMs: 15000 });
    const registerId = this.cashCurrentRegisterId;
    const till = (res.data?.accounts ?? []).find((a) => a.kind === 'till' && a.terminalId === `market-${registerId}` && a.objectId);
    return till ? String(till.objectId) : '';
  }

  /**
   * 1.5.33: older versions' demo catalogue (p-wolt-*, ~4300 Wolt products) was
   * copied into some accounts from a browser cache. Once per account, on the
   * warehouse PC: its goods leave Mallar and its products the selling screen
   * (product.delete deactivates and syncs, so the other PCs follow).
   */
  async purgeDemoCatalog() {
    if (this.settings().demoPurged) return;
    const links = { ...(this.settings().links || {}) };
    for (const id of Object.keys(links).filter((key) => key.startsWith('p-wolt-'))) {
      const res = await this.invoke('ingredients.deactivate', { ingredientId: links[id] }, { timeoutMs: 15000 });
      if (!res.success && !/tapılmadı/.test(res.error?.message || '')) throw new Error(res.error?.message || 'Demo mal silinmədi');
      delete links[id];
    }
    const list = await this.market.invoke('product.list', { activeOnly: true }, 60000);
    if (!list?.success || !Array.isArray(list.data)) throw new Error('Məhsullar oxunmadı');
    for (const p of list.data.filter((row) => String(row.id).startsWith('p-wolt-'))) {
      const res = await this.market.invoke('product.delete', { id: p.id, actorId: 'system' }, 15000);
      if (!res?.success) throw new Error(res?.error?.message || 'Demo məhsul silinmədi');
    }
    this.saveSettings({ links, demoPurged: true });
    this.scheduleCatalog();
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
          // One bad batch must not keep every product's quantity off the till.
          if (!res.success) console.error('[ops-import] batch', i, res.error?.message);
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
      const sales = await this.market.invoke('sale.list', { since: Date.now() - 3 * 864e5, limit: 5000, withRefunds: true }, 60000);
      for (const sale of Array.isArray(sales?.data) ? sales.data : []) {
        fed.add(sale.id);
        fed.add(`r:${sale.id}`);
        for (const refund of sale.refunds || []) fed.add(`r:${refund.refundId}`);
      }
      const linkedAt = { ...(this.settings().linkedAt || {}) };
      for (const id of Object.keys(links)) if (!linkedAt[id]) linkedAt[id] = Date.now();
      this.saveSettings({ links, linkedAt, legacyImported: true, fed: [...fed].slice(-4000) });
      console.log(`[ops-import] ${Object.keys(links).length} Market products linked to Mallar`);
    } finally {
      this.busy.importing = false;
    }
  }

  /** Receipts and returns set aside after failed tries are offered to the warehouse again. */
  retryParked() {
    const settings = this.settings();
    if (Object.keys(settings.parked || {}).length || Object.keys(settings.failures || {}).length) this.saveSettings({ parked: {}, failures: {} });
    this.strayTried = new Set();
  }

  /** The strays pass on its own, before sales are booked (syncCatalog repeats it after). */
  async linkCatalogStrays() {
    if (!this.isHost() || this.core.state !== 'ready' || this.market.state !== 'ready') return false;
    const listRes = await this.market.invoke('product.list', { activeOnly: false }, 60000);
    if (!listRes?.success || !Array.isArray(listRes.data)) throw new Error(listRes?.error?.message || 'Kassa malları oxunmadı');
    const goodsRes = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
    if (!goodsRes.success) throw new Error(goodsRes.error?.message || 'Anbar malları oxunmadı');
    return this.linkStrays(listRes.data, goodsRes.data?.goods ?? []);
  }

  /**
   * When each product became a good. A receipt older than that already had its
   * quantity taken off the stock that came into Mallar, so it is booked
   * without moving stock again (noStock). Links made before 1.5.28 count from
   * the first start of 1.5.28; their earlier receipts are re-offered once and
   * the warehouse ignores the ones it already has (same externalId).
   */
  linkedAt() {
    const settings = this.settings();
    if (settings.linkedAt) return settings.linkedAt;
    const now = Date.now();
    const linkedAt = Object.fromEntries(Object.keys(settings.links || {}).map((id) => [id, now]));
    this.saveSettings({ linkedAt, fed: [], failures: {}, parked: {}, feedV2: now });
    return linkedAt;
  }

  /**
   * Active Market products that are neither ops-* nor linked: link each to the
   * good with its barcode (or name), import the rest into Mallar, and take a
   * duplicate of an already linked good off the selling screen. Returns true
   * when links changed, so the catalog pass starts again with them.
   */
  async linkStrays(products, goods) {
    const links = { ...(this.settings().links || {}) };
    const strays = products.filter((p) => p.active !== false && p.kind !== 'service' && !String(p.id).startsWith('ops-') && !links[p.id]);
    if (!strays.length) return false;
    const key = (text) => String(text || '').trim().toLocaleLowerCase('az');
    const index = (rows) => ({ barcode: new Map(rows.filter((g) => g.barcode).map((g) => [String(g.barcode), g])), name: new Map(rows.map((g) => [key(g.name), g])) });
    let found = index(goods);
    // A barcode decides; the name only for a product without one (two breads may share a name).
    const match = (p) => (p.barcode ? found.barcode.get(String(p.barcode)) : found.name.get(key(p.name?.az)));
    // Each product is offered to the import once per run; one Mallar refuses is not retried every 15 s.
    this.strayTried = this.strayTried || new Set();
    const missing = strays.filter((p) => !match(p) && !this.strayTried.has(p.id));
    for (const p of missing) this.strayTried.add(p.id);
    if (missing.length) {
      const unit = (u) => (u === 'kq' ? 'kg' : u === 'litr' ? 'l' : 'ədəd');
      const rows = missing.map((p) => ({ name: String(p.name?.az || p.sku || ''), barcode: String(p.barcode || ''), unit: unit(p.unit),
        costMinor: Math.max(0, Number(p.costMinor) || 0), salePriceMinor: Math.max(0, Number(p.priceMinor) || 0), category: String(p.category || '') }));
      for (let i = 0; i < rows.length; i += 500) {
        // updateExisting false: a good already in Anbar keeps its own price.
        const res = await this.invoke('goods.import', { rows: rows.slice(i, i + 500), updateExisting: false }, { timeoutMs: 120000 });
        if (!res.success) console.error('[ops-strays] import', i, res.error?.message);
      }
      const again = await this.invoke('goods.list', { objectId: await this.branchObject() }, { timeoutMs: 60000 });
      if (!again.success) return false;
      found = index(again.data?.goods ?? []);
    }
    const taken = new Set(Object.values(links));
    let changed = false;
    for (const p of strays) {
      const good = match(p);
      if (!good) continue;  // the import failed; the next pass tries again
      if (taken.has(String(good.id))) {
        // Another product already is this good: one selling-screen entry per good.
        const res = await this.market.invoke('product.update', { product: { ...p, active: false }, actorId: 'system' }, 15000);
        if (!res?.success) console.error('[ops-strays] duplicate', p.id, res?.error?.message);
        continue;
      }
      links[p.id] = String(good.id);
      taken.add(String(good.id));
      changed = true;
      const stock = Math.round((Number(p.stock) || 0) * 1000) - (Number(good.qtyMilli) || 0);
      if (missing.includes(p) && stock > 0) {
        await this.invoke('inventory.adjust', { ingredientId: String(good.id), qtyDeltaMilli: stock, reason: 'Market qalığı (köçürmə)' },
          { idempotencyKey: `mkt-stock-${p.id}`, timeoutMs: 15000 });
      }
    }
    if (changed) {
      const linkedAt = { ...this.linkedAt() };
      for (const id of Object.keys(links)) if (!linkedAt[id]) linkedAt[id] = Date.now();
      // Receipts set aside for a missing good get another go now that it exists.
      this.saveSettings({ links, linkedAt, parked: {}, failures: {} });
      console.log(`[ops-strays] ${Object.keys(links).length} products linked to Mallar`);
    }
    return changed;
  }

  async syncRegisters() { await syncRegisters(this); }
  async syncWarehouseLedger() { await syncWarehouseLedger(this); }

  async cashOpening(registerId) {
    const result = await this.invoke('cashAccounts.list', {});
    if (!result.success) throw new Error(result.error?.message || 'Kassa qalığı alınmadı');
    const account = result.data.accounts.find(a => a.kind === 'till' && a.terminalId === `market-${registerId}`);
    if (!account || !Number.isSafeInteger(account.balanceMinor) || account.balanceMinor < 0) throw new Error('Kassa qalığını yoxlayın');
    return account.balanceMinor;
  }

  async cashSummary() {
    if (!this.isHost()) throw new Error('Kassa əlaqəsi anbar kompüterində işləyir');
    await this.flushCatalog({ timeoutMs: 20000 });
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const result = await this.invoke('cashAccounts.list', { from: from.getTime(), to: Date.now() + 1 });
    if (!result.success) throw new Error(result.error?.message || 'Kassa məlumatı alınmadı');
    return { accounts: result.data.accounts, registerNames: Object.fromEntries(this.registers) };
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
      // First, so a one-time reset of `fed` (see linkedAt) is what this pass reads.
      const linkedAt = this.linkedAt();
      // Services are not goods; a receipt line for one never waits for Mallar.
      let services = null;
      const serviceIds = async () => {
        if (services) return services;
        const listed = await this.market.invoke('product.list', { activeOnly: false }, 60000);
        services = new Set((Array.isArray(listed?.data) ? listed.data : []).filter((p) => p.kind === 'service').map((p) => String(p.id)));
        return services;
      };
      // Three days back covers a return made on a later day; older sales are booked.
      const res = await this.market.invoke('sale.list', { since: Date.now() - 3 * 864e5, limit: 3000, withRefunds: true }, 60000);
      if (!res?.success || !Array.isArray(res.data)) throw new Error(res?.error?.message || 'Till sales unavailable');
      let complete = true;
      const fed = new Set(this.settings().fed || []);
      // A receipt the warehouse keeps refusing is set aside after a few tries
      // (market-ops.json "parked", with the reason) instead of holding every
      // quantity off the till behind it.
      const failures = { ...(this.settings().failures || {}) };
      const parked = { ...(this.settings().parked || {}) };
      const failed = (key, message) => {
        failures[key] = (failures[key] || 0) + 1;
        if (failures[key] < 3) return false;
        parked[key] = { at: Date.now(), error: String(message || '') };
        delete failures[key];
        console.error('[ops-feed] parked', key, message);
        return true;
      };
      const links = this.settings().links || {};
      let changed = false;
      // A receipt set aside (parked) is not "fed": "Yenidən göndər" clears the
      // parked list and it is offered again. A return waits for its sale.
      const settle = (key, ok, reason) => {
        if (ok) { fed.add(key); changed = true; return; }
        changed = true;
        if (!failed(key, reason)) complete = false;
      };
      for (const sale of res.data.slice().reverse()) {
        const terminal = { id: `market-${sale.registerId || 'kassa'}`, name: await this.registerName(String(sale.registerId || '')) };
        if (!fed.has(sale.id) && !parked[sale.id]) {
          const booked = await this.recordSale(sale, terminal, links, linkedAt, serviceIds);
          settle(sale.id, booked === true, booked);
        }
        if (!fed.has(sale.id)) continue;
        const money = saleMoney(sale);
        let refundedBefore = 0;
        for (const refund of sale.refunds || []) {
          const key = `r:${refund.refundId}`;
          const amount = (refund.lines || []).reduce((t, l) => t + (Number(l.amountMinor) || 0), 0);
          const tenders = refundTenders(money, amount, refundedBefore, Number(sale.totalMinor) || 0);
          refundedBefore += amount;
          if (fed.has(key) || parked[key]) continue;
          const lines = (refund.lines || []).filter((l) => goodOf(l.productId, links))
            .map((l) => ({ ingredientId: goodOf(l.productId, links), qtyMilli: refundQtyMilli(l, sale.items),
              ...(stockBefore(l.productId, refund.createdAt, linkedAt) ? { noStock: true } : {}) }));
          settle(key, await this.recordRefund(key, sale.id, lines, tenders, refund.createdAt, terminal), 'Qaytarma Anbara yazılmadı');
        }
        const full = `r:${sale.id}`;
        if (sale.refunded && !(sale.refunds || []).length && !fed.has(full) && !parked[full]) {
          const lines = saleLines(sale.items, links).map((l) => ({ ingredientId: l.ingredientId, qtyMilli: l.qtyMilli,
            ...(stockBefore(l.productId, sale.refundedAt || sale.createdAt, linkedAt) ? { noStock: true } : {}) }));
          settle(full, await this.recordRefund(full, sale.id, lines, { cashMinor: money.cash, cardMinor: money.card, creditMinor: money.credit }, Date.now(), terminal), 'Qaytarma Anbara yazılmadı');
        }
      }
      if (changed) this.saveSettings({ fed: [...fed].slice(-4000), failures, parked });
      return complete;
    } finally {
      this.busy.feed = false;
    }
  }

  async recordSale(sale, terminal, links, linkedAt = {}, serviceIds = async () => new Set()) {
    // A receipt with a product that is not a good is not "done": it waits
    // (and is set aside with the reason after a few tries) instead of
    // vanishing from Satışlar, which is what happened before 1.5.28.
    let missing = (sale.items || []).filter((item) => !goodOf(item.productId, links));
    if (missing.length) { const skip = await serviceIds(); missing = missing.filter((item) => !skip.has(String(item.productId))); }
    if (missing.length) return `Anbarda olmayan mal: ${missing.map((item) => item.name || item.productId).slice(0, 3).join(', ')}`;
    const lines = saleLines(sale.items, links).map((line) => (stockBefore(line.productId, sale.createdAt, linkedAt) ? { ...line, noStock: true } : line));
    if (!lines.length) return true;  // an empty receipt
    const money = saleMoney(sale);
    const linesTotal = lines.reduce((t, l) => t + l.totalMinor, 0);
    const res = await this.invoke('sales.recordExternal', {
      externalId: sale.id, number: sale.receiptNo, warehouseId:String(sale.warehouseId||'').startsWith('ops-wh-')?String(sale.warehouseId).slice(7):this.settings().primaryOpsWarehouse||'', at: Number(sale.createdAt) || Date.now(), lines,
      cashMinor: money.cash, cardMinor: money.card, creditMinor: money.credit, customerId:sale.customerId||"",creditInMarketLedger:true,
      discountMinor: Math.max(0, linesTotal - (money.cash + money.card + money.credit)),
    }, { terminal, idempotencyKey: `mkt-sale-${sale.id}`, timeoutMs: 30000 });
    if (!res.success) console.error('[ops-feed] sale', sale.receiptNo, res.error?.message);
    return res.success ? true : (res.error?.message || 'xəta');
  }

  async recordRefund(externalId, saleId, lines, money, at, terminal) {
    const res = await this.invoke('sales.recordExternalRefund', {
      externalId, saleExternalId: saleId, creditInMarketLedger:true, lines, at: Number(at) || Date.now(), reason: 'Market qaytarma', ...money,
    }, { terminal, idempotencyKey: `mkt-${externalId}`, timeoutMs: 30000 });
    // E_NOT_FOUND: the sale itself was never booked (nothing from Mallar on it),
    // so neither is its return.
    if (!res.success && res.error?.code === 'E_NOT_FOUND') return true;
    if (!res.success) console.error('[ops-feed] refund', externalId, res.error?.message);
    return res.success;
  }
}

module.exports = { OpsEngine, docPermission, stockBefore, marketProduct, sameProduct, lineQtyMilli, refundQtyMilli, saleMoney, saleLines, goodOf, receiptDocument, isCatalogWrite, ok, fail };
