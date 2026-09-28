'use strict';

/**
 * Printer, cash-drawer, payment-terminal and fiscal IPC.
 *
 * Every handler checks the calling frame (assertTrusted) and a verified staff
 * session; privileged actions go through the core's permission checks. See
 * drawer-auth.cjs for the drawer and hardware-policy.cjs for mock hardware.
 */
const { buildXzReportEscPos } = require('./hardware/printer');
const { openDrawerAuthorized } = require('./drawer-auth.cjs');
const { mockHardwareAllowed, resolveTerminalMode } = require('./hardware-policy.cjs');
const { CorePrinterProvider } = require('./hardware/printer');
const { MockFiscalProvider } = require('./hardware/fiscal');
const { ManualTerminalProvider, MockTerminalProvider } = require('./hardware/terminal');

/** Registers the hardware channels and returns the printer provider main uses elsewhere. */
function registerHardwareIpc({ ipcMain, app, coreSupervisor, assertTrusted, requireSession, requireCorePermission, verifyManagerPin }) {
  // Printing goes through the core, which owns the device. The file and mock
  // providers stay in hardware/printer.js for tests; wiring one here is what
  // made the till report a printed receipt that never left the machine.
  const printerSession = () => ({ role: 'manager', actorId: 'system' });
  const printerProvider = new CorePrinterProvider(
    (method, payload, timeoutMs) => coreSupervisor.invoke(method, payload, timeoutMs),
    printerSession,
  );
  const allowMockHardware = mockHardwareAllowed({ isPackaged: app.isPackaged });
  const fiscalProvider = new MockFiscalProvider();
  let terminalProvider = new ManualTerminalProvider();

  ipcMain.handle('market:printer:list', (event) => { assertTrusted(event); return printerProvider.listPrinters(); });
  ipcMain.handle('market:printer:health', (event) => { assertTrusted(event); return printerProvider.health(); });
  // Detection sweeps the LAN and prints a page to each candidate, so it is
  // gated on a real manager session rather than the placeholder role used for
  // ordinary receipts - and given room to run, because a subnet sweep plus a
  // probe per candidate does not finish inside the default timeout.
  ipcMain.handle('market:printer:detect', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    return coreSupervisor.invoke(
      'printer.detect',
      { role: user.role, actorId: user.id, probe: input?.probe !== false },
      90000,
    );
  });
  ipcMain.handle('market:printer:setTarget', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    return coreSupervisor.invoke('printer.setTarget', {
      role: user.role,
      actorId: user.id,
      target: String(input?.target || ''),
    });
  });
  ipcMain.handle('market:printer:test', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    return printerProvider.printTest({ widthMm: input?.widthMm || 80 });
  });
  ipcMain.handle('market:printer:configure', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    const target = String(input?.target || '').trim();
    // The core owns the printer now; 1.4 wrote a file here that nothing read.
    await coreSupervisor.invoke('printer.setTarget', { role: user.role, actorId: user.id, target });
    const health = await printerProvider.health();
    return { ...health, target };
  });
  ipcMain.handle('market:printer:report', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const report = input?.report || {};
    return printerProvider.printRaw(buildXzReportEscPos(report, { widthMm: input?.widthMm || 80 }), {
      kind: String(report.reportType || 'X').toLowerCase() === 'z' ? 'z-report' : 'x-report',
    });
  });
  ipcMain.handle('market:printer:receipt', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    return printerProvider.printReceipt(input?.receipt || {}, { widthMm: input?.widthMm || 80, cut: input?.cut !== false });
  });
  ipcMain.handle('market:printer:label', async (event, input) => {
    assertTrusted(event); await requireCorePermission(input?.sessionToken, 'PRINT_LABEL');
    const product = input?.product || {}; const count = Math.max(1, Math.min(100, Number(input?.count || 1)));
    const productName = typeof product.name === 'object' ? (product.name.az || product.name.en || product.name.ru || '') : product.name;
    const title = Buffer.from(`${String(productName || '').slice(0, 32)}\nKod: ${String(product.internalCode || product.sku || '')}\n${product.color ? `Reng: ${product.color} ` : ''}${product.size ? `Olcu: ${product.size}` : ''}\nQiymet: ${(Number(product.priceMinor || 0) / 100).toFixed(2)} AZN\n`, 'utf8');
    const code = Buffer.from(String(product.barcode || ''), 'ascii');
    const barcode = code.length ? Buffer.concat([Buffer.from([0x1d, 0x68, 70, 0x1d, 0x77, 2, 0x1d, 0x6b, 73, code.length]), code, Buffer.from('\n\n')]) : Buffer.from('\n');
    const payload = Buffer.concat(Array.from({ length: count }, () => Buffer.concat([Buffer.from([0x1b, 0x40, 0x1b, 0x61, 1]), title, barcode])));
    return printerProvider.printRaw(payload, { kind: 'barcode-label', count });
  });
  // Identity from the session, approval from main's own PIN check, hardware only
  // after the core granted and logged OPEN_DRAWER - see drawer-auth.cjs.
  ipcMain.handle('market:drawer:open', async (event, input) => {
    assertTrusted(event);
    return openDrawerAuthorized(
      { reason: input?.reason, managerPin: input?.managerPin },
      {
        resolveUser: () => requireSession(input?.sessionToken),
        verifyManagerPin,
        invokeCore: (method, payload) => coreSupervisor.invoke(method, payload),
        openDrawer: () => printerProvider.openDrawer(),
      },
    );
  });
  ipcMain.handle('market:terminal:pay', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const mode = resolveTerminalMode(String(input?.mode || 'manual'), allowMockHardware);
    terminalProvider = mode === 'mock_integrated' ? new MockTerminalProvider() : new ManualTerminalProvider();
    const result = await terminalProvider.startPayment({
      amountMinor: Number(input?.amountMinor) || 0,
      reference: String(input?.reference || '').slice(0, 64),
    });
    result.provider = mode;
    if (result.status === 'declined') {
      const err = new Error('Terminal declined');
      err.code = 'TERMINAL_DECLINED';
      throw err;
    }
    return result;
  });
  ipcMain.handle('market:fiscal:processPending', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    if (!allowMockHardware) {
      return {
        success: false,
        error: { code: 'FISCAL_NOT_CONFIGURED', message: 'Fiskal provayder qurulmayıb — çeklər növbədə qalır', retryable: false },
      };
    }
    const pending = await coreSupervisor.invoke('fiscal.listPending', {});
    if (!pending.success) return pending;
    const results = [];
    for (const job of pending.data || []) {
      try {
        const req = JSON.parse(job.request_json || '{}');
        const out = job.kind === 'refund'
          ? await fiscalProvider.registerRefund(req)
          : await fiscalProvider.registerSale(req);
        await coreSupervisor.invoke('fiscal.updateStatus', {
          id: job.id,
          status: out.status,
          fiscalReceiptId: out.fiscalReceiptId,
          qrData: out.qrData,
          response: out.response,
        });
        results.push({ id: job.id, status: out.status });
      } catch (error) {
        await coreSupervisor.invoke('fiscal.updateStatus', {
          id: job.id,
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
        });
        results.push({ id: job.id, status: 'failed' });
      }
    }
    return { success: true, data: results };
  });
  return printerProvider;
}

module.exports = { registerHardwareIpc };
