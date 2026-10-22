'use strict';

const bwip = require('bwip-js');
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_DESIGN = Object.freeze({ offsetX: 0, offsetY: 0, margin: 8, showName: true, nameX: 0, nameY: 0, nameSize: 16, nameLines: 2, nameAlign: 'center', nameBold: true, priceX: 0, priceY: 0, priceSize: 22, priceAlign: 'center', priceBold: true, barcodeX: 0, barcodeY: 0, barcodeHeight: 0, barWidth: 0, digitsX: 0, digitsY: 0, digitsSize: 14, digitsBold: false, showDigits: true, caption: '', showCaption: false, captionX: 0, captionY: 0, captionSize: 12, captionAlign: 'center', captionBold: false, pricePosition: 'top', showBarcode: true, nameScaleX: 1, nameScaleY: 1, priceScaleX: 1, priceScaleY: 1, digitsScaleX: 1, digitsScaleY: 1, captionScaleX: 1, captionScaleY: 1, nameFont: 'Arial', priceFont: 'Arial', digitsFont: 'monospace', captionFont: 'Arial', nameItalic: false, priceItalic: false, digitsItalic: false, captionItalic: false, inkScale: 1, barEdits: {} });
// `unit` is only how the screens show sizes (mm, inch or printer dots); the
// profile itself is always millimetres and dots.
const DEFAULT_SAMPLE = Object.freeze({ name: '', price: '', barcode: '2001234567893' });
const FONTS = ['Arial', 'Tahoma', 'Segoe UI', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'sans-serif', 'serif', 'monospace'];
const DEFAULT_PROFILE = Object.freeze({ target: '', name: '', model: 'xp350b', protocol: 'tspl', widthMm: 45, heightMm: 25, gapMm: 2, dpi: 203, maxWidthMm: 76, showPrice: true, unit: 'mm', design: DEFAULT_DESIGN, sample: DEFAULT_SAMPLE });
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
  for (const k of ['offsetX','offsetY','nameX','nameY','priceX','priceY','barcodeX','barcodeY','digitsX','digitsY','captionX','captionY']) if (!Number.isFinite(d[k]) || Math.abs(d[k]) > Number.MAX_SAFE_INTEGER) fail('E_LABEL_DESIGN');
  for (const k of ['nameScaleX','nameScaleY','priceScaleX','priceScaleY','digitsScaleX','digitsScaleY','captionScaleX','captionScaleY']) if (!Number.isFinite(d[k]) || d[k] <= 0 || d[k] > 1000) fail('E_LABEL_DESIGN');
  for (const k of ['nameSize','priceSize','digitsSize','captionSize']) if (!Number.isFinite(d[k]) || d[k] < 6 || d[k] > 400) fail('E_LABEL_DESIGN');
  for (const k of ['showName','nameBold','priceBold','digitsBold','showDigits','showCaption','captionBold','showBarcode','nameItalic','priceItalic','digitsItalic','captionItalic']) if (typeof d[k] !== 'boolean') fail('E_LABEL_DESIGN');
  for (const k of ['nameAlign','priceAlign','captionAlign']) if (!['left','center','right'].includes(d[k])) fail('E_LABEL_DESIGN');
  if (!['top','bottom'].includes(d.pricePosition)) fail('E_LABEL_DESIGN');
  if (!Number.isFinite(d.margin) || d.margin < 0 || d.margin > 100 || !Number.isInteger(d.nameLines) || d.nameLines < 1 || d.nameLines > 3 || !Number.isFinite(d.barcodeHeight) || d.barcodeHeight < 0 || d.barcodeHeight > 2000 || !Number.isFinite(d.barWidth) || d.barWidth < 0 || d.barWidth > 64 || typeof d.caption !== 'string' || d.caption.length > 120 || /[\r\n\0]/.test(d.caption)) fail('E_LABEL_DESIGN');
  for (const key of ['nameFont','priceFont','digitsFont','captionFont']) if (!FONTS.includes(d[key])) fail('E_LABEL_DESIGN');
  if (!Number.isFinite(d.inkScale) || d.inkScale < .1 || d.inkScale > 3 || !d.barEdits || typeof d.barEdits !== 'object' || Array.isArray(d.barEdits) || Object.keys(d.barEdits).length > 600) fail('E_LABEL_DESIGN');
  d.barEdits = Object.fromEntries(Object.entries(d.barEdits).map(([key, value]) => {
    if (!/^(0|[1-9][0-9]{0,3})$/.test(key) || Number(key) > 1200 || Number(key) % 2 || !value || typeof value !== 'object' || Array.isArray(value)) fail('E_LABEL_DESIGN');
    const e = { shift: 0, top: 0, width: 1, height: 1, hidden: false, ...value };
    if (![e.shift,e.top,e.width,e.height].every(Number.isFinite) || Math.abs(e.shift) > 1e7 || Math.abs(e.top) > 1e7 || e.width <= 0 || e.width > 1000 || e.height <= 0 || e.height > 1000 || typeof e.hidden !== 'boolean') fail('E_LABEL_DESIGN');
    return [key, { shift: e.shift, top: e.top, width: e.width, height: e.height, hidden: e.hidden }];
  }));
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
  const sample = { ...DEFAULT_SAMPLE, ...input.sample };
  if (typeof sample.name !== 'string' || sample.name.length > 400 || typeof sample.price !== 'string' || sample.price.length > 80 || !validEan13(sample.barcode) || /[\r\n\0]/.test(sample.name + sample.price)) fail('E_LABEL_SAMPLE');
  p.sample = { name: sample.name, price: sample.price, barcode: sample.barcode };
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
function layout(product, settings, lang = 'az', sample = false) {
  const p = profile(settings), v = p.design;
  const code = String(product.barcode || '');
  const needsCode = v.showBarcode || v.showDigits;
  // Never silently truncate or replace code bytes. Text is data, not printer commands.
  if (needsCode && !/^[\x20-\x7e]{1,80}$/.test(code)) fail(code ? 'E_LABEL_CODE' : 'E_LABEL_NO_BARCODE');
  if (!Number.isSafeInteger(product.priceMinor) || product.priceMinor < 0) fail('E_LABEL_PRICE');
  const name = typeof product.name === 'object' ? (product.name[lang] || product.name.az || product.name.en) : product.name;
  // Nominal 203/300 DPI thermal heads address 8/12 dots per millimetre.
  const dotsPerMm = p.dpi === 203 ? 8 : 12;
  const width = Math.floor(p.widthMm * dotsPerMm / 8) * 8, height = Math.round(p.heightMm * dotsPerMm);
  const warnings = [];
  let bars = [], symbology = '', quiet = 0, moduleWidth = 0;
  if (v.showBarcode && code) {
    symbology = validEan13(code) ? 'ean13' : 'code128';
    bars = bwip.raw({ bcid: symbology, text: code, includetext: false, parse: false, parsefnc: false })[0].sbs;
    const modules = bars.reduce((a, b) => a + b, 0);
    quiet = symbology === 'ean13' ? 11 : 10;
    // Whatever the operator chooses is drawn; what may not scan is a warning, not a refusal.
    moduleWidth = v.barWidth || Math.max(1, Math.min(4, Math.floor((width - v.margin * 2) / (modules + quiet * 2))));
    if (moduleWidth < Math.ceil(p.dpi / 25.4 * 0.19) || (modules + quiet * 2) * moduleWidth > width) warnings.push('E_LABEL_TOO_NARROW');
  }
  return { profile: p, width, height, bars, moduleWidth, margin: v.margin, quiet, symbology, code, warnings, name: String(name || '').slice(0, 400), price: sample && p.sample.price ? p.sample.price : `${(product.priceMinor / 100).toFixed(2)} AZN` };
}
/**
 * Self-contained sandbox renderer: all coordinates/sizes are physical printer dots.
 *
 * Draws exactly what was designed - like a photo editor, nothing is refused.
 * Parts past the paper edge are cut by the paper; text over the barcode may
 * stop it scanning. Both come back as `warnings` for the screen to show.
 */
/* global document -- drawLabel runs inside the hidden render window (executeJavaScript), not in main. */
function drawLabel(d) {
  const c = document.createElement('canvas'); c.width = d.width; c.height = d.height;
  let ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  const v = d.profile.design, m = v.margin, spacing = 3, boxes = {}, pending = [], warnings = [...(d.warnings || [])];
  let y = m, truncated = false, barcodeBase = null; const stripes = [];
  function font(key, size, bold) {
    const family = v[key + 'Font'] || (key === 'digits' ? 'monospace' : 'Arial');
    const fallback = /Courier|mono/.test(family) ? 'monospace' : /Times|Georgia|^serif$/.test(family) ? 'serif' : 'sans-serif';
    ctx.font = `${v[key + 'Italic'] ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px "${family}", ${fallback}`;
  }
  function textBlock(key, text, size, bold, align, baseY, lineCount = 1, wrap = false) {
    const maxWidth = Math.max(1, c.width - m * 2);
    font(key, size, bold); ctx.textAlign = 'left';
    let rest = text, lines = [];
    if (wrap) {
      while (rest && lines.length < lineCount) {
        let n = rest.length;
        while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxWidth) n--;
        if (n < rest.length && rest.slice(0, n).lastIndexOf(' ') > n / 2) n = rest.slice(0, n).lastIndexOf(' ');
        lines.push(rest.slice(0, n)); rest = rest.slice(n).trimStart();
      }
      if (rest && lines.length) { let last = lines.pop(); while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1); lines.push(last + '…'); truncated = true; }
    } else lines = [text];
    const sx = v[key + 'ScaleX'] ?? 1, sy = v[key + 'ScaleY'] ?? 1;
    const naturalWidth = Math.ceil(Math.max(0, ...lines.map(s => ctx.measureText(s).width))), width = naturalWidth * sx, lineHeight = Math.ceil(size * 1.2);
    const height = lines.length ? lines.length * lineHeight * sy : 0;
    const baseX = align === 'left' ? m : align === 'right' ? c.width - m - width : (c.width - width) / 2;
    const x = baseX + v.offsetX + v[key + 'X'], top = baseY + v.offsetY + v[key + 'Y'];
    const ink = lines.map(line => { const metric = ctx.measureText(line), start = align === 'left' ? 0 : align === 'right' ? naturalWidth - metric.width : (naturalWidth - metric.width) / 2; return { left: start - (metric.actualBoundingBoxLeft || 0), right: start + (metric.actualBoundingBoxRight || metric.width) }; });
    const inkLeft = Math.min(0, ...ink.map(b => b.left)) * sx, inkRight = Math.max(naturalWidth, ...ink.map(b => b.right)) * sx;
    boxes[key] = { x: x + inkLeft, y: top, width: inkRight - inkLeft, height };
    pending.push({ key, draw: () => { ctx.save(); ctx.translate(x, top); ctx.scale(sx, sy); font(key, size, bold); ctx.textAlign = align; const anchor = align === 'left' ? 0 : align === 'right' ? naturalWidth : naturalWidth / 2; lines.forEach((line, i) => ctx.fillText(line, anchor, i * lineHeight)); ctx.restore(); } });
    return height;
  }
  const hasBars = v.showBarcode && d.bars.length > 0;
  if (v.showName) y += textBlock('name', d.name, v.nameSize, v.nameBold, v.nameAlign, y, v.nameLines, true) + spacing;
  const priceBottom = d.profile.showPrice && v.pricePosition === 'bottom';
  if (d.profile.showPrice && !priceBottom) y += textBlock('price', d.price, v.priceSize, v.priceBold, v.priceAlign, y) + spacing;
  if (hasBars) {
    const digitsHeight = v.showDigits ? Math.ceil(v.digitsSize * 1.2) * v.digitsScaleY + spacing : 0;
    const captionHeight = v.showCaption && v.caption ? Math.ceil(v.captionSize * 1.2) * v.captionScaleY + spacing : 0;
    const priceHeight = priceBottom ? Math.ceil(v.priceSize * 1.2) * v.priceScaleY + spacing : 0;
    const minHeight = Math.round(d.profile.dpi / 203 * 35);
    let barHeight = v.barcodeHeight || Math.floor(c.height - y - m - digitsHeight - captionHeight - priceHeight);
    // Too little room left for an automatic height: draw a readable minimum and say so.
    if (barHeight < minHeight) { warnings.push('E_LABEL_BAR_HEIGHT'); if (!v.barcodeHeight) barHeight = minHeight; }
    const fullWidth = d.bars.reduce((a, b) => a + b, 0) * d.moduleWidth;
    const bx = (c.width - fullWidth) / 2 + v.offsetX + v.barcodeX, by = y + v.offsetY + v.barcodeY;
    barcodeBase = { x: bx - d.quiet * d.moduleWidth, y: by, width: fullWidth + d.quiet * d.moduleWidth * 2, height: barHeight };
    let cursor = bx;
    d.bars.forEach((n, index) => {
      if (index % 2 === 0) {
        const e = v.barEdits[index] || { shift: 0, top: 0, width: 1, height: 1, hidden: false }, width = n * d.moduleWidth * v.inkScale * e.width;
        stripes.push({ index, x: cursor + (n * d.moduleWidth - width) / 2 + e.shift * d.moduleWidth, y: by + e.top * barHeight, width, height: barHeight * e.height, hidden: e.hidden });
      }
      cursor += n * d.moduleWidth;
    });
    const minX = Math.min(barcodeBase.x, ...stripes.map(b => b.x)), minY = Math.min(by, ...stripes.map(b => b.y));
    const maxX = Math.max(barcodeBase.x + barcodeBase.width, ...stripes.map(b => b.x + b.width)), maxY = Math.max(by + barHeight, ...stripes.map(b => b.y + b.height));
    boxes.barcode = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    if (Object.keys(v.barEdits).length || v.inkScale !== 1) warnings.push('E_LABEL_CUSTOM_BARS');
    pending.push({ key: 'barcode', draw: () => stripes.forEach(b => { if (!b.hidden) ctx.fillRect(b.x, b.y, b.width, b.height); }) });
    y += barHeight + spacing;
  }
  if (v.showDigits && d.code) y += textBlock('digits', d.code, v.digitsSize, v.digitsBold, 'center', y) + spacing;
  if (priceBottom) y += textBlock('price', d.price, v.priceSize, v.priceBold, v.priceAlign, y) + spacing;
  if (v.showCaption && v.caption) textBlock('caption', v.caption, v.captionSize, v.captionBold, v.captionAlign, y);
  // Warnings only: the bars past the edge (the quiet zone may reach it), any
  // part cut by the paper, text on top of the barcode.
  const bars = (k, b) => k === 'barcode' ? { ...b, x: b.x + d.quiet * d.moduleWidth, width: b.width - 2 * d.quiet * d.moduleWidth } : b;
  const outside = Object.entries(boxes).filter(([k, raw]) => { const b = bars(k, raw); return b.width > 0 && (b.x < 0 || b.y < 0 || b.x + b.width > c.width || b.y + b.height > c.height); }).map(([k]) => k);
  if (outside.length) warnings.push('E_LABEL_CLIPPED');
  const overlap = [];
  if (boxes.barcode) for (const [k, b] of Object.entries(boxes)) {
    const a = boxes.barcode;
    if (k !== 'barcode' && b.width > 0 && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) overlap.push(k);
  }
  if (overlap.length) warnings.push('E_LABEL_OVERLAP');
  // Isolated transparent layers keep live dragging faithful to the printer renderer,
  // including objects outside the paper. Only preview resolution is bounded.
  const layers = {}, paperCtx = ctx;
  for (const { key, draw } of pending) {
    const box = boxes[key], factor = Math.min(1, 2048 / Math.max(1, box.width, box.height));
    const layer = document.createElement('canvas');
    layer.width = Math.max(1, Math.ceil(box.width * factor)); layer.height = Math.max(1, Math.ceil(box.height * factor));
    ctx = layer.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.scale(factor, factor); ctx.translate(-box.x, -box.y); draw();
    const data = ctx.getImageData(0, 0, layer.width, layer.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const black = data.data[i + 3] >= 96 && data.data[i] * .299 + data.data[i + 1] * .587 + data.data[i + 2] * .114 < 160;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 0; data.data[i + 3] = black ? 255 : 0;
    }
    ctx.putImageData(data, 0, 0); layers[key] = layer.toDataURL('image/png');
  }
  ctx = paperCtx;
  pending.forEach(({ draw }) => draw());
  // The displayed preview and printer bytes share this exact thresholded raster.
  const pixels = ctx.getImageData(0, 0, c.width, c.height), mono = new Uint8Array(c.width / 8 * c.height);
  for (let i = 0; i < c.width * c.height; i++) {
    const off = i * 4, black = pixels.data[off] * 0.299 + pixels.data[off + 1] * 0.587 + pixels.data[off + 2] * 0.114 < 160;
    if (black) mono[i >> 3] |= 0x80 >> (i & 7);
    pixels.data[off] = pixels.data[off + 1] = pixels.data[off + 2] = black ? 0 : 255;
  }
  ctx.putImageData(pixels, 0, 0);
  let binary = ''; for (const byte of mono) binary += String.fromCharCode(byte);
  return { image: c.toDataURL('image/png'), mono: btoa(binary), width: c.width, height: c.height, nameTruncated: truncated, boxes, layers, stripes, barcodeBase, moduleWidth: d.moduleWidth, warnings: [...new Set(warnings)], outside, overlap };
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
  async function prepare(product, p, lang, sample = false) {
    const d = layout(product, p, lang, sample), key = JSON.stringify(d);
    if (cache.has(key)) return cache.get(key);
    // Rendering is serialized; stale previews cannot race on a shared canvas.
    const task = (rendering || Promise.resolve()).catch(() => {}).then(() => renderImage(d)); rendering = task;
    const image = await task;
    if (image && image.error) throw Error(/^E_LABEL_[A-Z0-9_]+$/.test(image.error) ? image.error : 'E_LABEL_RENDER');
    cache.set(key, image); if (cache.size > 12) cache.delete(cache.keys().next().value); return image;
  }
  async function products() { const rows = await invoke('product.list', { activeOnly: true }); return rows.filter(p => p.active !== false && p.kind !== 'service'); }
  async function product(id) { const p = await invoke('product.get', { id: String(id || '') }); if (!p || p.active === false || p.kind === 'service') fail('E_LABEL_PRODUCT'); return p; }
  const sampleProduct = p => ({ barcode: p.sample.barcode, name: p.sample.name || { az: 'Nümunə məhsul', ru: 'Пример товара', en: 'Sample product' }, priceMinor: 1250 });
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
    async preview(id, input, lang) { const settings = profile(input), p = id ? await product(id) : sampleProduct(settings); const image = await prepare(p, settings, lang, !id); return { image: image.image, width: image.width, height: image.height, barcode: p.barcode, nameTruncated: image.nameTruncated, boxes: image.boxes, layers: image.layers, stripes: image.stripes, barcodeBase: image.barcodeBase, moduleWidth: image.moduleWidth, warnings: image.warnings || [], outside: image.outside || [], overlap: image.overlap || [], symbology: validEan13(p.barcode) ? 'EAN-13' : 'Code 128' }; },
    print(id, input, count, operationId, lang, test = false) {
      // A stable operation key covers retries after a timeout, including failures:
      // bytes may have reached paper before a transport error. Reprint is explicit.
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(operationId || ''))) fail('E_LABEL_JOB_KEY');
      const signature = JSON.stringify([id, profile(input), count, lang, test]);
      if (jobs.has(operationId)) { const old = jobs.get(operationId); if (old.signature !== signature) fail('E_LABEL_JOB_CHANGED'); return old.task; }
      if (jobs.size >= 2000) fail('E_LABEL_JOB_LIMIT');
      const task = (async () => {
        const settings = profile(input); target(settings.target);
        const p = test && !id ? sampleProduct(settings) : await product(id);
        const rendered = await prepare(p, settings, lang, test && !id), bytes = buildJob(rendered, settings, count);
        await invoke('printer.send', { target: settings.target, bytes: Array.from(bytes) }, 30000);
        return { ok: true, copies: count, target: settings.target, operationId, barcode: p.barcode };
      })();
      jobs.set(operationId, { signature, task }); return task;
    },
    driverUrl(vendor) { return Object.hasOwn(DRIVER_URLS, vendor) ? DRIVER_URLS[vendor] : DRIVER_URLS.xprinter; },
  };
}
module.exports = { DEFAULT_DESIGN, DEFAULT_PROFILE, design, validEan13, profile, target, classifyPrinters, layout, drawLabel, buildJob, createLabelService };
