'use strict';

const bwip = require('bwip-js');
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_DESIGN = Object.freeze({ offsetX: 0, offsetY: 0, margin: 8, showName: true, nameX: 0, nameY: 0, nameSize: 16, nameLines: 2, nameAlign: 'center', nameBold: true, priceX: 0, priceY: 0, priceSize: 22, priceAlign: 'center', priceBold: true, barcodeX: 0, barcodeY: 0, barcodeHeight: 0, barWidth: 0, digitsX: 0, digitsY: 0, digitsSize: 14, digitsBold: false, showDigits: true, caption: '', showCaption: false, captionX: 0, captionY: 0, captionSize: 12, captionAlign: 'center', captionBold: false, pricePosition: 'top' });
// `unit` is only how the screens show sizes (mm, inch or printer dots); the
// profile itself is always millimetres and dots.
const DEFAULT_PROFILE = Object.freeze({ target: '', name: '', model: 'xp350b', protocol: 'tspl', widthMm: 45, heightMm: 25, gapMm: 2, dpi: 203, maxWidthMm: 76, showPrice: true, unit: 'mm', design: DEFAULT_DESIGN });
const DRIVER_URLS = Object.freeze({ xprinter: 'https://www.xprinter.net/companyfile/32.html', tsc: 'https://www.tscprinters.com/en/downloads', zebra: 'https://www.zebra.com/us/en/support-downloads/printers.html' });
const fail = (code) => { throw new Error(code); };
function number(value, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('E_LABEL_SIZE'); return value; }
function target(value, allowEmpty = false) {
  const s = String(value || '').trim();
  if ((!s && !allowEmpty) || s.length > 2048 || /[\r\n\0]/.test(s) || (s && !/^(usbraw:|win:|usb:|tcp:|serial:)/i.test(s)) || /pdf|onenote|xps|fax|virtual/i.test(s)) fail('E_LABEL_TARGET');
  return s;
}
function design(input = {}, dpi = 203) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('E_LABEL_DESIGN');
  const defaults = { ...DEFAULT_DESIGN };
  if (dpi === 300) for (const k of ['margin', 'nameSize', 'priceSize', 'digitsSize', 'captionSize']) defaults[k] = Math.round(defaults[k] * 1.5);
  const d = { ...defaults, ...input };
  for (const k of ['offsetX','offsetY','nameX','nameY','priceX','priceY','barcodeX','barcodeY','digitsX','digitsY','captionX','captionY']) if (!Number.isInteger(d[k]) || Math.abs(d[k]) > 3000) fail('E_LABEL_DESIGN');
  for (const k of ['nameSize','priceSize','digitsSize','captionSize']) if (!Number.isInteger(d[k]) || d[k] < 8 || d[k] > 120) fail('E_LABEL_DESIGN');
  for (const k of ['showName','nameBold','priceBold','digitsBold','showDigits','showCaption','captionBold']) if (typeof d[k] !== 'boolean') fail('E_LABEL_DESIGN');
  for (const k of ['nameAlign','priceAlign','captionAlign']) if (!['left','center','right'].includes(d[k])) fail('E_LABEL_DESIGN');
  if (!['top','bottom'].includes(d.pricePosition)) fail('E_LABEL_DESIGN');
  if (!Number.isInteger(d.margin) || d.margin < 0 || d.margin > 100 || !Number.isInteger(d.nameLines) || d.nameLines < 1 || d.nameLines > 3 || !Number.isInteger(d.barcodeHeight) || d.barcodeHeight < 0 || d.barcodeHeight > 2000 || !Number.isInteger(d.barWidth) || d.barWidth < 0 || d.barWidth > 8 || typeof d.caption !== 'string' || d.caption.length > 120 || /[\r\n\0]/.test(d.caption)) fail('E_LABEL_DESIGN');
  return Object.fromEntries(Object.keys(DEFAULT_DESIGN).map(k => [k, d[k]]));
}
function validEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((s, n, i) => s + Number(n) * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(code[12]);
}
function profile(input = {}) {
  const p = { ...DEFAULT_PROFILE, ...input };
  if (!['tspl', 'zpl'].includes(p.protocol) || !['xp350b', 'generic'].includes(p.model) || ![203, 300].includes(p.dpi) || typeof p.showPrice !== 'boolean' || !['mm', 'in', 'dot'].includes(p.unit)) fail('E_LABEL_PROFILE');
  if (p.model === 'xp350b' && (p.dpi !== 203 || p.protocol !== 'tspl')) fail('E_LABEL_PROFILE');
  p.target = target(p.target, true); p.name = String(p.name || '').slice(0, 200);
  p.maxWidthMm = p.model === 'xp350b' ? 76 : number(p.maxWidthMm, 20, 112);
  p.widthMm = number(p.widthMm, 20, p.maxWidthMm); p.heightMm = number(p.heightMm, 20, 150); p.gapMm = number(p.gapMm, 0, 10);
  p.design = design(input.design || {}, p.dpi);
  return Object.fromEntries(Object.keys(DEFAULT_PROFILE).map(k => [k, p[k]]));
}
function classifyPrinters(printers = [], current = '') {
  const seen = new Set();
  return printers.flatMap(p => {
    try { target(p.target); } catch { return []; }
    const name = [p.displayName, p.model, p.driver, p.commandSet].filter(Boolean).join(' ');
    if (/laserjet|deskjet|inkjet|officejet|epson.*tm-|receipt|esc\/pos/i.test(name) && !/350b|label|tspl|zpl/i.test(name)) return [];
    const xp350 = /(?:xp[\s-]*)?350b/i.test(name);
    const tspl = xp350 || /\btspl2?\b|\btsc\b|xprinter.*(?:\d{3}b\b|label)|gprinter.*(?:label|\bgp[\s-]*\d)/i.test(name);
    const zpl = /\bzpl\b|\bzebra\b/i.test(name);
    const key = String(p.target).toLowerCase(); if (seen.has(key)) return []; seen.add(key);
    return [{ target: p.target, name: p.displayName || p.model || p.target, model: p.model || '', connection: p.connection || '', driver: p.driver || '', compatible: tspl || zpl, protocol: zpl && !tspl ? 'zpl' : 'tspl', preset: xp350 ? 'xp350b' : 'generic', direct: key.startsWith('usbraw:') || key.startsWith('tcp:'), selected: p.target === current }];
  }).sort((a, b) => Number(b.compatible) - Number(a.compatible) || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
}
function layout(product, settings, lang = 'az') {
  const p = profile(settings);
  const code = String(product.barcode || '');
  // Never silently truncate or replace code bytes. Text is data, not printer commands.
  if (!/^[\x20-\x7e]{1,80}$/.test(code)) fail(code ? 'E_LABEL_CODE' : 'E_LABEL_NO_BARCODE');
  if (!Number.isSafeInteger(product.priceMinor) || product.priceMinor < 0) fail('E_LABEL_PRICE');
  const name = typeof product.name === 'object' ? (product.name[lang] || product.name.az || product.name.en) : product.name;
  // Nominal 203/300 DPI thermal heads address 8/12 dots per millimetre.
  const dotsPerMm = p.dpi === 203 ? 8 : 12;
  const width = Math.floor(p.widthMm * dotsPerMm / 8) * 8, height = Math.round(p.heightMm * dotsPerMm);
  const symbology = validEan13(code) ? 'ean13' : 'code128';
  const bars = bwip.raw({ bcid: symbology, text: code, includetext: false, parse: false, parsefnc: false })[0].sbs;
  const modules = bars.reduce((a, b) => a + b, 0), margin = p.design.margin, quiet = symbology === 'ean13' ? 11 : 10;
  const moduleWidth = p.design.barWidth || Math.min(4, Math.floor((width - margin * 2) / (modules + quiet * 2)));
  if (moduleWidth < Math.ceil(p.dpi / 25.4 * 0.19) || (modules + quiet * 2) * moduleWidth > width) fail('E_LABEL_TOO_NARROW');
  return { profile: p, width, height, bars, moduleWidth, margin, quiet, symbology, code, name: String(name || '').slice(0, 400), price: `${(product.priceMinor / 100).toFixed(2)} AZN` };
}
/** Self-contained sandbox renderer: all coordinates/sizes are physical printer dots. */
/* global document -- drawLabel runs inside the hidden render window (executeJavaScript), not in main. */
function drawLabel(d) {
  const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  const v = d.profile.design, m = v.margin, spacing = 3, boxes = {}, pending = [], fitted = {};
  const sizes = { price: v.priceSize, digits: v.digitsSize, caption: v.captionSize };
  let y = m, truncated = false;
  function font(size, bold, mono = false) { ctx.font = `${bold ? 'bold ' : ''}${size}px ${mono ? 'monospace' : 'Arial'}`; }
  /**
   * Text that stays on the paper wherever it is moved. The room is what is left
   * between the shifted anchor and the paper edge: a long name wraps/shortens
   * into it, the price, digits and custom text shrink their font into it
   * (never below 6 dots). Only a shift that puts the anchor itself off the
   * paper is refused (E_LABEL_CLIPPED).
   */
  function textBlock(key, text, size, bold, align, baseY, lineCount = 1, allowShorten = false) {
    const shift = v.offsetX + v[key + 'X'];
    const room = align === 'left' ? c.width - (m + shift) : align === 'right' ? c.width - m + shift : c.width - 2 * Math.abs(shift);
    const maxWidth = Math.max(1, Math.min(c.width - m * 2, room));
    font(size, bold, key === 'digits');
    if (!allowShorten) {
      while (size > 6 && ctx.measureText(text).width > maxWidth) { size -= 1; font(size, bold, key === 'digits'); }
      if (size !== sizes[key]) fitted[key] = size;
    }
    let rest = text, lines = [];
    if (allowShorten) {
      while (rest && lines.length < lineCount) {
        let n = rest.length;
        while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxWidth) n--;
        if (n < rest.length && rest.slice(0, n).lastIndexOf(' ') > n / 2) n = rest.slice(0, n).lastIndexOf(' ');
        lines.push(rest.slice(0, n)); rest = rest.slice(n).trimStart();
      }
      if (rest && lines.length) { let last = lines.pop(); while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1); lines.push(last + '…'); truncated = true; }
    } else lines = [text];
    const width = Math.ceil(Math.max(0, ...lines.map(s => ctx.measureText(s).width))), lineHeight = Math.ceil(size * 1.2);
    const height = lines.length ? (lines.length - 1) * lineHeight + Math.ceil(size * 1.2) : 0;
    const baseX = align === 'left' ? m : align === 'right' ? c.width - m - width : (c.width - width) / 2;
    const x = Math.round(baseX + v.offsetX + v[key + 'X']), top = Math.round(baseY + v.offsetY + v[key + 'Y']);
    boxes[key] = { x, y: top, width, height };
    pending.push(() => { font(size, bold, key === 'digits'); ctx.textAlign = align; const anchor = align === 'left' ? x : align === 'right' ? x + width : x + width / 2; lines.forEach((line, i) => ctx.fillText(line, anchor, top + i * lineHeight)); });
    return height;
  }
  if (v.showName) y += textBlock('name', d.name, v.nameSize, v.nameBold, v.nameAlign, y, v.nameLines, true) + spacing;
  const priceBottom = d.profile.showPrice && v.pricePosition === 'bottom';
  if (d.profile.showPrice && !priceBottom) y += textBlock('price', d.price, v.priceSize, v.priceBold, v.priceAlign, y) + spacing;
  const digitsHeight = v.showDigits ? Math.ceil(v.digitsSize * 1.2) + spacing : 0;
  const captionHeight = v.showCaption && v.caption ? Math.ceil(v.captionSize * 1.2) + spacing : 0;
  const priceHeight = priceBottom ? Math.ceil(v.priceSize * 1.2) + spacing : 0;
  const barHeight = v.barcodeHeight || Math.floor(c.height - y - m - digitsHeight - captionHeight - priceHeight);
  if (barHeight < Math.round(d.profile.dpi / 203 * 35)) throw Error('E_LABEL_BAR_HEIGHT');
  const fullWidth = d.bars.reduce((a, b) => a + b, 0) * d.moduleWidth;
  const bx = Math.floor((c.width - fullWidth) / 2) + v.offsetX + v.barcodeX, by = y + v.offsetY + v.barcodeY;
  boxes.barcode = { x: bx - d.quiet * d.moduleWidth, y: by, width: fullWidth + d.quiet * d.moduleWidth * 2, height: barHeight };
  pending.push(() => { let x = bx; d.bars.forEach((n, i) => { if (i % 2 === 0) ctx.fillRect(x, by, n * d.moduleWidth, barHeight); x += n * d.moduleWidth; }); });
  y += barHeight + spacing;
  if (v.showDigits) y += textBlock('digits', d.code, v.digitsSize, v.digitsBold, 'center', y) + spacing;
  if (priceBottom) y += textBlock('price', d.price, v.priceSize, v.priceBold, v.priceAlign, y) + spacing;
  if (v.showCaption && v.caption) textBlock('caption', v.caption, v.captionSize, v.captionBold, v.captionAlign, y);
  // The bars must be on the paper; their quiet zone may run to the paper edge,
  // which is blank anyway. Overlap below still keeps text out of the quiet zone.
  const onPaper = (k, b) => k === 'barcode' ? { ...b, x: b.x + d.quiet * d.moduleWidth, width: b.width - 2 * d.quiet * d.moduleWidth } : b;
  for (const [k, raw] of Object.entries(boxes)) { const b = onPaper(k, raw); if (b.x < 0 || b.y < 0 || b.x + b.width > c.width || b.y + b.height > c.height) throw Error('E_LABEL_CLIPPED'); }
  const items = Object.entries(boxes);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i][1], b = items[j][1];
    if (a.width > 0 && b.width > 0 && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) throw Error('E_LABEL_OVERLAP');
  }
  pending.forEach(draw => draw());
  // The displayed preview and printer bytes share this exact thresholded raster.
  const pixels = ctx.getImageData(0, 0, c.width, c.height), mono = new Uint8Array(c.width / 8 * c.height);
  for (let i = 0; i < c.width * c.height; i++) {
    const off = i * 4, black = pixels.data[off] * 0.299 + pixels.data[off + 1] * 0.587 + pixels.data[off + 2] * 0.114 < 160;
    if (black) mono[i >> 3] |= 0x80 >> (i & 7);
    pixels.data[off] = pixels.data[off + 1] = pixels.data[off + 2] = black ? 0 : 255;
  }
  ctx.putImageData(pixels, 0, 0);
  let binary = ''; for (const byte of mono) binary += String.fromCharCode(byte);
  return { image: c.toDataURL('image/png'), mono: btoa(binary), width: c.width, height: c.height, nameTruncated: truncated, boxes, fitted, moduleWidth: d.moduleWidth };
}

function buildJob(rendered, settings, copies) {
  const p = profile(settings); target(p.target);
  if (!Number.isSafeInteger(copies) || copies < 1 || copies > 100) fail('E_LABEL_COUNT');
  const bytes = Buffer.from(rendered.mono, 'base64'), stride = rendered.width / 8;
  if (!Number.isInteger(stride) || bytes.length !== stride * rendered.height) fail('E_LABEL_BITMAP');
  if (p.protocol === 'zpl') {
    const hex = bytes.toString('hex').toUpperCase();
    return Buffer.from(`^XA\n^PW${rendered.width}\n^LL${rendered.height}\n^LH0,0\n${p.gapMm > 0 ? '^MNY' : '^MNN'}\n^FO0,0^GFA,${bytes.length},${bytes.length},${stride},${hex}^FS\n^PQ${copies},0,1,N\n^XZ\n`, 'ascii');
  }
  // TSPL BITMAP: 0 = black, 1 = white (opposite to ZPL's graphic field).
  const bitmap = Buffer.from(bytes.map(b => b ^ 255));
  return Buffer.concat([Buffer.from(`SIZE ${p.widthMm} mm,${p.heightMm} mm\r\nGAP ${p.gapMm} mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,${stride},${rendered.height},0,`, 'ascii'), bitmap, Buffer.from(`\r\nPRINT 1,${copies}\r\n`, 'ascii')]);
}
function createLabelService({ app, coreSupervisor, opsEngine, render }) {
  const configPath = path.join(app.getPath('userData'), 'label-printer.json');
  const invoke = async (method, payload, timeoutMs = 20000) => {
    const res = await coreSupervisor.invoke(method, payload, timeoutMs);
    if (!res?.success) throw new Error(res?.error?.message || 'E_LABEL_CORE'); return res.data;
  };
  const read = () => { try { return profile(JSON.parse(fs.readFileSync(configPath, 'utf8'))); } catch (e) { if (e.code === 'ENOENT') return { ...DEFAULT_PROFILE }; throw Error('E_LABEL_CONFIG'); } };
  let rendering;
  async function renderImage(d) {
    if (render) return render(d);
    // Isolated, short-lived renderer. It receives structured data, has no preload,
    // no Node, no network or navigation, and never loads remote product images.
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', e => e.preventDefault());
    try { await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'">')); const out = await w.webContents.executeJavaScript(`(() => { try { return (${drawLabel.toString()})(${JSON.stringify(d)}); } catch (e) { return { error: String(e && e.message || e) }; } })()`);
      // A throw inside executeJavaScript arrives as "Script failed to execute":
      // the reason (clipped, overlap, bar height) comes back as data instead.
      return out; }
    finally { if (!w.isDestroyed()) w.destroy(); }
  }
  const cache = new Map();
  async function prepare(product, p, lang) {
    const d = layout(product, p, lang), key = JSON.stringify(d);
    if (cache.has(key)) return cache.get(key);
    // Rendering is serialized; stale previews cannot race on a shared canvas.
    const task = (rendering || Promise.resolve()).catch(() => {}).then(() => renderImage(d)); rendering = task;
    const image = await task;
    if (image && image.error) throw Error(/^E_LABEL_[A-Z_]+$/.test(image.error) ? image.error : 'E_LABEL_RENDER');
    cache.set(key, image); if (cache.size > 12) cache.delete(cache.keys().next().value); return image;
  }
  async function products() { const rows = await invoke('product.list', { activeOnly: true }); return rows.filter(p => p.active !== false && p.kind !== 'service'); }
  async function product(id) { const p = await invoke('product.get', { id: String(id || '') }); if (!p || p.active === false || p.kind === 'service') fail('E_LABEL_PRODUCT'); return p; }
  const jobs = new Map();
  return {
    read,
    save(input) { const next = profile(input); target(next.target); fs.mkdirSync(path.dirname(configPath), { recursive: true }); const tmp = configPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(next, null, 2)); fs.renameSync(tmp, configPath); return next; },
    products,
    async discover(user, network = false) { const p = read(), res = await invoke('printer.list', network ? { labelScan: true, knownTarget: p.target, role: user.role, actorId: user.id } : {}, 30000); return { printers: classifyPrinters(res.printers, p.target), profile: p }; },
    async generate(id, user, options = {}) {
      const p = await product(id);
      if (options.barcode && !validEan13(options.barcode)) fail('E_LABEL_EAN13');
      if (p.barcode && !options.replaceExisting) return p;
      if (!opsEngine.isHost()) fail('E_LABEL_HOST');
      const goodId = id.startsWith('ops-') ? id.slice(4) : opsEngine.settings().links?.[id];
      if (!goodId) fail('E_LABEL_UNLINKED');
      const res = await opsEngine.invoke('ingredients.save', { id: goodId, generateBarcodeOnly: true, ...(options.replaceExisting ? { replaceBarcode: true, previousBarcode: String(options.previousBarcode ?? p.barcode) } : {}), ...(options.barcode ? { barcode: options.barcode } : {}) }, { idempotencyKey: `label-code-${id}`, terminal: { id: 'market-labels', name: user.name || 'Market' } });
      if (!res?.success || !res.data?.barcode) {
        const message = res?.error?.message || '';
        if (message.includes('Bu barkod başqa mala')) fail('E_LABEL_DUPLICATE');
        if (message.includes('Malın barkodu dəyişib')) fail('E_LABEL_CODE_CHANGED');
        throw Error(message || 'E_LABEL_CODE');
      }
      try { await opsEngine.flushCatalog({ timeoutMs: 20000 }); } catch { fail('E_LABEL_SYNC'); }
      const refreshed = await product(id);
      if (refreshed.barcode !== res.data.barcode) fail('E_LABEL_SYNC');
      return refreshed;
    },
    async preview(id, input, lang) { const p = id ? await product(id) : { barcode: '2001234567893', name: { az: 'Nümunə məhsul', ru: 'Пример товара', en: 'Sample product' }, priceMinor: 1250 }; const image = await prepare(p, profile(input), lang); return { image: image.image, width: image.width, height: image.height, barcode: p.barcode, nameTruncated: image.nameTruncated, boxes: image.boxes, fitted: image.fitted || {}, moduleWidth: image.moduleWidth, symbology: validEan13(p.barcode) ? 'EAN-13' : 'Code 128' }; },
    print(id, input, count, operationId, lang, test = false) {
      // A stable operation key covers retries after a timeout, including failures:
      // bytes may have reached paper before a transport error. Reprint is explicit.
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(operationId || ''))) fail('E_LABEL_JOB_KEY');
      const signature = JSON.stringify([id, profile(input), count, lang, test]);
      if (jobs.has(operationId)) { const old = jobs.get(operationId); if (old.signature !== signature) fail('E_LABEL_JOB_CHANGED'); return old.task; }
      if (jobs.size >= 2000) fail('E_LABEL_JOB_LIMIT');
      const task = (async () => {
        const settings = profile(input); target(settings.target);
        const p = test && !id ? { barcode: '2001234567893', name: { az: 'Nümunə məhsul', ru: 'Пример товара', en: 'Sample product' }, priceMinor: 1250 } : await product(id);
        const rendered = await prepare(p, settings, lang), bytes = buildJob(rendered, settings, count);
        await invoke('printer.send', { target: settings.target, bytes: Array.from(bytes) }, 30000);
        return { ok: true, copies: count, target: settings.target, operationId, barcode: p.barcode };
      })();
      jobs.set(operationId, { signature, task }); return task;
    },
    driverUrl(vendor) { return Object.hasOwn(DRIVER_URLS, vendor) ? DRIVER_URLS[vendor] : DRIVER_URLS.xprinter; },
  };
}
module.exports = { DEFAULT_DESIGN, DEFAULT_PROFILE, design, validEan13, profile, target, classifyPrinters, layout, drawLabel, buildJob, createLabelService };
