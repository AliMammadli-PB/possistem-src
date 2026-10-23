'use strict';

/**
 * Printer, cash-drawer, payment-terminal and fiscal IPC.
 *
 * Every handler checks the calling frame (assertTrusted) and a verified staff
 * session; privileged actions go through the core's permission checks. See
 * drawer-auth.cjs for the drawer and hardware-policy.cjs for mock hardware.
 */
const { buildStationTicketEscPos, buildXzReportEscPos } = require('./hardware/printer');
const { openDrawerAuthorized } = require('./drawer-auth.cjs');
const { mockHardwareAllowed, resolveTerminalMode } = require('./hardware-policy.cjs');
const { createReceiptOnce } = require('./receipt-once.cjs');
const { createLabelService } = require('./label-printer.cjs');
const { CorePrinterProvider } = require('./hardware/printer');
const { MockFiscalProvider } = require('./hardware/fiscal');
const { ManualTerminalProvider, MockTerminalProvider } = require('./hardware/terminal');

/** Registers the hardware channels and returns the printer provider main uses elsewhere. */
function registerHardwareIpc({ ipcMain, app, coreSupervisor, assertTrusted, requireSession, requireCorePermission, verifyManagerPin, opsEngine, staffName, currentSunmiActor }) {
  // Printing goes through the core, which owns the device. The file and mock
  // providers stay in hardware/printer.js for tests; wiring one here is what
  // made the till report a printed receipt that never left the machine.
  const printerSession = () => ({ role: 'manager', actorId: 'system' });
  const printerProvider = new CorePrinterProvider(
    (method, payload, timeoutMs) => coreSupervisor.invoke(method, payload, timeoutMs),
    printerSession,
    // Parametrlər → Printer is the warehouse system's screen: its receipt
    // printer is the one the owner chose. "auto" means the first it can see.
    async () => {
      if (opsEngine?.core?.state !== 'ready') return '';
      const res = await opsEngine.invoke('print.printers', {}, { timeoutMs: 8000 });
      if (!res?.success) return '';
      const chosen = String(res.data?.receipt || '');
      if (chosen && chosen !== 'auto' && chosen !== 'virtual') return chosen;
      const seen = (res.data?.printers || []).find((p) => p?.name && p.connection !== 'virtual' && p.status !== 'offline');
      return seen ? String(seen.name) : '';
    },
  );
  const labels = createLabelService({ app, coreSupervisor, opsEngine });
  const allowMockHardware = mockHardwareAllowed({ isPackaged: app.isPackaged });
  const fiscalProvider = new MockFiscalProvider();
  const path = require('node:path');
  const {safeStorage} = require('electron');
  // 1.5.65: SUNMI ships in electron/sunmi (copied by package-market-win.mjs). 1.5.64 was built
  // without it; the old fallback pointed at the developer's tree, the require threw, and the till
  // never opened a window. A packaged app now never looks outside itself, and a missing SUNMI only
  // switches fiscal printing off instead of stopping the whole program.
  const sunmiOptions = {ipcMain,app,safeStorage,assertTrusted,actor:currentSunmiActor,invoke:(method,payload)=>coreSupervisor.invoke(method,payload),getDbPath:()=>coreSupervisor.dbPath};
  let sunmi;
  try {
    sunmi = require('node:fs').existsSync(path.join(__dirname,'sunmi/electron.cjs')) || app.isPackaged
      ? require('./sunmi/electron.cjs').registerSunmi(sunmiOptions)
      : require(path.join(__dirname, '..', '..', 'restoranpos', 'integrations', 'sunmi', 'electron.cjs')).registerSunmi(sunmiOptions); // dev tree only
  } catch (error) {
    console.error('[sunmi] not available, fiscal SUNMI disabled:', error?.message || error);
    const off = {enabled:false,printLocalCopy:false};
    ipcMain.handle('possistem:sunmi', (event) => { assertTrusted(event); return {ok:true,data:{config:off,jobs:[],canManage:false,unavailable:true}}; });
    sunmi = {service:{get:()=>off,documentStatus:()=>null,history:()=>[]},process:async()=>({enabled:false})};
  }

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
    printerProvider.forgetTarget();
    return coreSupervisor.invoke(
      'printer.detect',
      { role: user.role, actorId: user.id, probe: input?.probe !== false },
      90000,
    );
  });
  ipcMain.handle('market:printer:setTarget', async (event, input) => {
    assertTrusted(event);
    const user = requireSession(input?.sessionToken, ['manager']);
    printerProvider.forgetTarget();
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
    printerProvider.forgetTarget();
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
  const receiptOnce = createReceiptOnce();
  ipcMain.handle('market:printer:receipt', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const receipt = input?.receipt || {};
    if (sunmi.service.get().enabled && !sunmi.service.get().printLocalCopy) {
      await sunmi.process();
      const id=receipt.saleId||receipt.id;
      const result=id&&sunmi.service.documentStatus('sale:'+id);
      if(!result||result.state!=='done'||!result.result?.fiscalReceiptId)throw new Error(result?.error?.message||'Fiskal çek gözləyir. Parametrlər → SUNMI bölməsini yoxlayın.');
      return {ok:true,provider:'sunmi',fiscal:true};
    }

    return receiptOnce(receipt, async () => {
    // 1.5.1: the restaurant's receipt design (logo, QR, header from Parametrlər
    // → Çek dizaynı). The plain text receipt stays as the fallback.
    let designed = null;
    if (opsEngine?.core?.state === 'ready') {
      try {
        designed = await opsEngine.renderReceipt(receipt, {
          cashierName: staffName ? staffName(String(receipt.cashierId || '')) : '',
          registerName: await opsEngine.registerName(String(receipt.registerId || '')),
        });
      } catch (error) {
        console.error('[receipt] designed receipt failed, printing plain:', error instanceof Error ? error.message : error);
      }
    }
    // Only a failed layout falls back: a printer error must not print twice.
    if (designed) return printerProvider.printRaw(designed.bytes, { kind: 'receipt' });
    let openCashDrawer = true;
    if (opsEngine?.core?.state === 'ready') {
      try {
        const settings = await opsEngine.invoke('settings.getAll', {}, { timeoutMs: 2000 });
        if (settings?.success) openCashDrawer = String(settings.data?.settings?.['printer.openCashDrawer'] ?? '1') !== '0';
      } catch { /* The plain receipt still works if the layout core is unavailable. */ }
    }
    return printerProvider.printReceipt(receipt, { widthMm: input?.widthMm || 80, cut: input?.cut !== false, openCashDrawer });
    });
  });
  // Extra kitchen printers: one preparation ticket per station, to that
  // station's own printer (target), never to the till's receipt printer.
  ipcMain.handle('market:printer:station', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken);
    const target = String(input?.target || '').trim();
    if (!target) throw new Error('Stansiya printeri seçilməyib');
    return printerProvider.printRaw(buildStationTicketEscPos(input?.ticket || {}, { widthMm: input?.widthMm || 80 }), { kind: 'station', target });
  });
  ipcMain.handle('market:printer:label', async (event, input) => {
    assertTrusted(event); await requireCorePermission(input?.sessionToken, 'PRINT_LABEL');
    // Legacy callers also use the independent label profile and canonical good.
    return labels.print(input?.product?.id, labels.read(), input?.count ?? 1, input?.operationId, input?.lang || 'az');
  });
  ipcMain.handle('market:label:config', (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager', 'warehouse']);
    return labels.read();
  });
  ipcMain.handle('market:label:save', (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    return labels.save(input?.profile);
  });
  ipcMain.handle('market:label:discover', (event, input) => {
    assertTrusted(event); const user = requireSession(input?.sessionToken, ['manager']);
    return labels.discover(user, input?.network === true);
  });
  ipcMain.handle('market:label:products', (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager', 'warehouse']);
    return labels.products();
  });
  ipcMain.handle('market:label:generate', async (event, input) => {
    assertTrusted(event); const user = requireSession(input?.sessionToken, ['manager', 'warehouse']);
    await requireCorePermission(input?.sessionToken, 'EDIT_PRODUCT');
    return labels.generate(input?.productId, user, input?.options);
  });
  ipcMain.handle('market:label:preview', (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager', 'warehouse']);
    return labels.preview(input?.productId, input?.profile, input?.lang);
  });
  ipcMain.handle('market:label:print', async (event, input) => {
    assertTrusted(event); await requireCorePermission(input?.sessionToken, 'PRINT_LABEL');
    if (input?.test) requireSession(input?.sessionToken, ['manager']);
    return labels.print(input?.productId, input?.profile, input?.count, input?.operationId, input?.lang, input?.test === true);
  });
  ipcMain.handle('market:label:driver', async (event, input) => {
    assertTrusted(event); requireSession(input?.sessionToken, ['manager']);
    // Manufacturer pages only. No renderer-supplied URL, binary or shell command.
    await require('electron').shell.openExternal(labels.driverUrl(input?.vendor));
    return { ok: true };
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
    const mode = sunmi.service.get().enabled ? 'manual' : resolveTerminalMode(String(input?.mode || 'manual'), allowMockHardware);
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
    assertTrusted(event); requireSession(input?.sessionToken);
    if(sunmi.service.get().enabled)return sunmi.process();
    requireSession(input?.sessionToken,['manager']);
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
