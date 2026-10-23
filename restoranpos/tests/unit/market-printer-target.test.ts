/**
 * Market 1.5.27: a receipt that did not print must say so, and a till with no
 * printer of its own uses the one chosen in Parametrlər → Printer
 * (marketpos/electron/hardware/printer.js CorePrinterProvider).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { CorePrinterProvider } = require('../../../marketpos/electron/hardware/printer.js');

type Res = { success: boolean; data?: unknown; error?: { code: string; message: string } };
const core = (send: (target: string) => Res, current = '') => {
  const calls: string[] = [];
  const invoke = async (method: string, payload: Record<string, unknown>): Promise<Res> => {
    calls.push(`${method}:${String(payload?.target ?? '')}`);
    if (method === 'printer.list') return { success: true, data: { current, printers: [] } };
    if (method === 'printer.setTarget') return { success: true, data: { ok: true } };
    return send(String(payload?.target ?? ''));
  };
  return { invoke, calls };
};

describe('market receipt printer', () => {
  it('adopts the warehouse screen printer once and prints to it', async () => {
    const c = core((t) => ({ success: true, data: { bytes: 3, target: t } }));
    const p = new CorePrinterProvider(c.invoke, () => ({}), async () => 'usbraw:\\\\?\\usb#vid_0fe6');
    await expect(p.printRaw(Buffer.from('abc'))).resolves.toMatchObject({ ok: true, target: 'usbraw:\\\\?\\usb#vid_0fe6' });
    await p.printRaw(Buffer.from('abc'));
    expect(c.calls.filter((x) => x.startsWith('printer.setTarget')).length).toBe(1);
  });
  it('throws instead of reporting a receipt printed when the core refused', async () => {
    const c = core(() => ({ success: false, error: { code: 'PRINTER_NOT_CONFIGURED', message: 'Printer seçilməyib' } }));
    const p = new CorePrinterProvider(c.invoke, () => ({}), async () => '');
    await expect(p.printRaw(Buffer.from('a'))).rejects.toMatchObject({ code: 'PRINTER_NOT_CONFIGURED' });
  });
  it('keeps the till’s own printer when it has one', async () => {
    const c = core((t) => ({ success: true, data: { target: t } }), 'tcp:192.168.1.50:9100');
    const p = new CorePrinterProvider(c.invoke, () => ({}), async () => 'usbraw:other');
    await expect(p.printRaw(Buffer.from('a'))).resolves.toMatchObject({ target: 'tcp:192.168.1.50:9100' });
  });
});
