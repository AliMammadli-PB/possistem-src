/**
 * ESC/POS receipt builder + printer abstraction (no vendor lock-in).
 * Real device I/O uses Electron; this module builds byte buffers and a file/mock sink.
 */
'use strict';

const ESC = 0x1b;
const GS = 0x1d;

function textEncoder(str) {
  // ASCII-safe for thermal printers; AZ chars transliterated lightly
  return Buffer.from(String(str).normalize('NFKD').replace(/[\u0300-\u036f]/g, ''), 'utf8');
}

function escPosInit() {
  return Buffer.from([ESC, 0x40]);
}

function escPosAlign(n) {
  return Buffer.from([ESC, 0x61, n]); // 0 left 1 center 2 right
}

function escPosCut() {
  return Buffer.from([GS, 0x56, 0x00]);
}

function escPosDrawerPulse() {
  // ESC p m t1 t2 — pin 2 pulse
  return Buffer.from([ESC, 0x70, 0x00, 0x19, 0x19]);
}

function escPosLine(text, width = 42) {
  const line = String(text).slice(0, width) + '\n';
  return textEncoder(line);
}

function moneyAZN(minor) {
  return `AZN ${(Number(minor) / 100).toFixed(2)}`;
}

/**
 * @param {object} receipt from sale.receipt
 * @param {{ widthMm?: 58|80 }} opts
 */
function buildReceiptEscPos(receipt, opts = {}) {
  const width = opts.widthMm === 58 ? 32 : 42;
  const chunks = [escPosInit(), escPosAlign(1)];
  const store = String(receipt.storeName || 'TopdanPos').replace(/^"|"$/g, '');
  chunks.push(escPosLine(store, width));
  chunks.push(escPosAlign(0));
  chunks.push(escPosLine(`Qəbz: ${receipt.receiptNo}`, width));
  chunks.push(escPosLine(`Tarix: ${new Date(receipt.createdAt).toLocaleString()}`, width));
  chunks.push(escPosLine(`Kassa: ${receipt.registerId}  Kassir: ${receipt.cashierId}`, width));
  chunks.push(escPosLine('-'.repeat(width), width));
  for (const item of receipt.items || []) {
    const name = item.name || item.product_id || 'Məhsul';
    const qty = item.qty;
    const line = item.line_total_minor ?? item.lineTotalMinor;
    chunks.push(escPosLine(`${name}`, width));
    chunks.push(escPosLine(`  ${qty} x ${moneyAZN(item.unit_price_minor ?? item.unitPriceMinor)}  ${moneyAZN(line)}`, width));
  }
  chunks.push(escPosLine('-'.repeat(width), width));
  chunks.push(escPosLine(`Ara cəm: ${moneyAZN(receipt.subtotalMinor)}`, width));
  if (receipt.discountMinor) chunks.push(escPosLine(`Endirim: -${moneyAZN(receipt.discountMinor)}`, width));
  chunks.push(escPosLine(`YEKUN: ${moneyAZN(receipt.totalMinor)}`, width));
  chunks.push(escPosLine(`Ödəniş: ${receipt.paymentMethod}`, width));
  chunks.push(escPosLine(`Verildi: ${moneyAZN(receipt.tenderedMinor)}`, width));
  chunks.push(escPosLine(`Qalıq: ${moneyAZN(receipt.changeMinor)}`, width));
  // Bonus block. Printed only for a sale that actually had a card attached, so
  // an ordinary walk-in receipt keeps its current length. Without these lines a
  // customer earned and spent bonus with no proof of either.
  const earned = Number(receipt.loyaltyEarnedMinor || 0);
  const redeemed = Number(receipt.loyaltyRedeemedMinor || 0);
  if (earned > 0 || redeemed > 0) {
    chunks.push(escPosLine('-'.repeat(width), width));
    if (receipt.customerName) chunks.push(escPosLine(`Müştəri: ${receipt.customerName}`, width));
    if (redeemed > 0) chunks.push(escPosLine(`Bonusdan ödənildi: ${moneyAZN(redeemed)}`, width));
    if (earned > 0) chunks.push(escPosLine(`Qazanılan bonus: ${moneyAZN(earned)}`, width));
    chunks.push(escPosLine(`Bonus balansı: ${moneyAZN(receipt.loyaltyBalanceMinor || 0)}`, width));
  }
  if (receipt.fiscalStatus && receipt.fiscalStatus !== 'none') {
    chunks.push(escPosLine(`Fiskal: ${receipt.fiscalStatus}`, width));
  }
  if (receipt.fiscal?.qrData) chunks.push(escPosLine(`QR: ${receipt.fiscal.qrData}`, width));
  chunks.push(escPosLine('\n', width));
  if (opts.cut !== false) chunks.push(escPosCut());
  return Buffer.concat(chunks);
}

function buildTestPage(opts = {}) {
  const width = opts.widthMm === 58 ? 32 : 42;
  return Buffer.concat([
    escPosInit(),
    escPosAlign(1),
    escPosLine('TopdanPos TEST', width),
    escPosAlign(0),
    escPosLine(`Width: ${opts.widthMm || 80}mm`, width),
    escPosLine(new Date().toISOString(), width),
    escPosLine('-'.repeat(width), width),
    opts.cut === false ? Buffer.alloc(0) : escPosCut(),
  ]);
}

class MockPrinterProvider {
  constructor() {
    this.lastJob = null;
    this.online = true;
  }
  async listPrinters() {
    return [{ id: 'mock', name: 'Mock ESC/POS', widthMm: 80 }];
  }
  async health() {
    return { online: this.online, provider: 'mock' };
  }
  async printRaw(buffer, meta = {}) {
    if (!this.online) {
      const err = new Error('Printer offline');
      err.code = 'PRINTER_OFFLINE';
      throw err;
    }
    this.lastJob = { buffer, meta, at: Date.now() };
    return { ok: true, bytes: buffer.length };
  }
  async printReceipt(receipt, opts) {
    return this.printRaw(buildReceiptEscPos(receipt, opts), { kind: 'receipt' });
  }
  async printTest(opts) {
    return this.printRaw(buildTestPage(opts), { kind: 'test' });
  }
  async openDrawer() {
    return this.printRaw(escPosDrawerPulse(), { kind: 'drawer' });
  }
}

/**
 * The real sink: bytes go to the core, which owns the device.
 *
 * Everything above this line still builds the ESC/POS bytes here in Electron -
 * that part worked. What did not exist was anywhere to send them: the two
 * providers below write to memory and to a file, so the till reported a
 * successful print and the counter stayed empty. The core now carries the
 * restaurant's discovery and its four transports (USB raw, spooler queue,
 * serial, LAN), so the bytes are handed there with a target, or with none at
 * all when the till already has one configured.
 */
class CorePrinterProvider {
  /**
   * @param invoke (method, payload) => Promise - the core supervisor's invoke
   * @param session () => ({ role, actorId }) for calls the core gates on a role
   */
  constructor(invoke, session) {
    this.invoke = invoke;
    this.session = session || (() => ({}));
  }

  async listPrinters() {
    const result = await this.invoke('printer.list', {});
    return (result?.printers || []).map((printer) => ({
      id: printer.target,
      name: printer.displayName || printer.target,
      connection: printer.connection,
      model: printer.model,
      status: printer.status,
      isCurrent: Boolean(printer.isCurrent),
      // Only a device that answered DLE EOT 1 is known to be a printer; the
      // rest are candidates, and the list says so rather than implying more.
      confirmed: Boolean(printer.escposConfirmed),
      widthMm: 80,
    }));
  }

  async health() {
    const result = await this.invoke('printer.list', {});
    const current = result?.current || '';
    const match = (result?.printers || []).find((printer) => printer.target === current);
    return {
      provider: 'core',
      // No configured printer is not the same as one that is unreachable, and
      // the settings screen needs to tell the operator which it is.
      configured: Boolean(current),
      target: current,
      online: Boolean(current) && (!match || match.status === 'ready'),
    };
  }

  /** Finds every printer, prints a page to each until one takes it. */
  async detect(options = {}) {
    return this.invoke('printer.detect', { ...this.session(), probe: options.probe !== false }, 60000);
  }

  async setTarget(target) {
    return this.invoke('printer.setTarget', { ...this.session(), target });
  }

  async printRaw(buffer, meta = {}) {
    const result = await this.invoke('printer.send', {
      bytes: Array.from(buffer),
      ...(meta.target ? { target: meta.target } : {}),
    });
    return { ok: true, bytes: result?.bytes ?? buffer.length };
  }

  async printReceipt(receipt, opts) {
    return this.printRaw(buildReceiptEscPos(receipt, opts), { kind: 'receipt', target: opts?.target });
  }

  async printTest(opts) {
    return this.printRaw(buildTestPage(opts), { kind: 'test', target: opts?.target });
  }

  async openDrawer() {
    return this.printRaw(escPosDrawerPulse(), { kind: 'drawer' });
  }
}

/** File sink for diagnostics — writes .bin next to userData when path provided */
class FilePrinterProvider extends MockPrinterProvider {
  constructor(outPath) {
    super();
    this.outPath = outPath;
  }
  /** Nothing reaches paper here — callers must be able to tell this apart. */
  get physical() { return false; }
  async health() {
    return { online: true, provider: 'file', physical: false, outPath: this.outPath };
  }
  async printRaw(buffer, meta = {}) {
    const fs = require('node:fs');
    const path = require('node:path');
    if (this.outPath) {
      fs.mkdirSync(path.dirname(this.outPath), { recursive: true });
      fs.writeFileSync(this.outPath, buffer);
    }
    return super.printRaw(buffer, meta);
  }
}

class TcpPrinterProvider extends MockPrinterProvider {
  constructor(host, port = 9100) {
    super();
    this.host = host;
    this.port = Number(port) || 9100;
  }
  get physical() { return true; }
  async listPrinters() {
    return [{ id: `tcp:${this.host}:${this.port}`, name: `ESC/POS ${this.host}:${this.port}`, widthMm: 80 }];
  }
  async health() {
    return { online: true, provider: 'tcp', physical: true, host: this.host, port: this.port };
  }
  async printRaw(buffer, meta = {}) {
    const net = require('node:net');
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port }, () => {
        socket.write(buffer, () => {
          socket.end();
          resolve();
        });
      });
      socket.setTimeout(8000);
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Printer timeout'));
      });
      socket.on('error', reject);
    });
    this.lastJob = { buffer, meta, at: Date.now() };
    return { ok: true, bytes: buffer.length, provider: 'tcp' };
  }
}

function moneyLine(label, minor, width) {
  const amount = moneyAZN(minor);
  const pad = Math.max(1, width - label.length - amount.length);
  return escPosLine(`${label}${' '.repeat(pad)}${amount}`, width);
}

function buildXzReportEscPos(report, opts = {}) {
  const width = opts.widthMm === 58 ? 32 : 42;
  const kind = String(report.reportType || 'X');
  const chunks = [escPosInit(), escPosAlign(1)];
  chunks.push(escPosLine(kind === 'Z' ? 'Z HESABAT' : 'X HESABAT', width));
  chunks.push(escPosAlign(0));
  chunks.push(escPosLine('-'.repeat(width), width));
  chunks.push(escPosLine(`Kassa: ${report.registerId || ''}`, width));
  if (report.openedAt) chunks.push(escPosLine(`Acilis: ${new Date(report.openedAt).toLocaleString('az-AZ')}`, width));
  if (report.closedAt) chunks.push(escPosLine(`Baglanis: ${new Date(report.closedAt).toLocaleString('az-AZ')}`, width));
  chunks.push(escPosLine(`Cek sayi: ${report.transactionCount ?? 0}`, width));
  chunks.push(moneyLine('Umumi satis', report.grossSalesMinor ?? 0, width));
  chunks.push(moneyLine('Xalis', report.netSalesMinor ?? 0, width));
  chunks.push(moneyLine('Nagd', report.cashSalesMinor ?? 0, width));
  chunks.push(moneyLine('Kart', report.cardSalesMinor ?? 0, width));
  chunks.push(moneyLine('Gozlenen kassa', report.expectedCashMinor ?? 0, width));
  if (kind === 'Z') {
    chunks.push(moneyLine('Sayilan nagd', report.actualCashMinor ?? 0, width));
    chunks.push(moneyLine('Ferq', report.differenceMinor ?? 0, width));
  }
  chunks.push(escPosLine('-'.repeat(width), width));
  chunks.push(escPosAlign(1));
  chunks.push(escPosLine(new Date().toLocaleString('az-AZ'), width));
  chunks.push(escPosCut());
  return Buffer.concat(chunks);
}

function createPrinterProvider(outPath, target) {
  const spec = String(target || process.env.TOPDAN_POS_PRINTER || '').trim();
  if (spec.startsWith('tcp:')) {
    const rest = spec.slice(4);
    const colon = rest.lastIndexOf(':');
    const host = colon === -1 ? rest : rest.slice(0, colon);
    const port = colon === -1 ? 9100 : rest.slice(colon + 1);
    return new TcpPrinterProvider(host, port);
  }
  return new FilePrinterProvider(outPath);
}

module.exports = {
  buildReceiptEscPos,
  buildTestPage,
  buildXzReportEscPos,
  escPosDrawerPulse,
  CorePrinterProvider,
  MockPrinterProvider,
  FilePrinterProvider,
  TcpPrinterProvider,
  createPrinterProvider,
};
