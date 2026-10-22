'use strict';
/**
 * Label scales on the shop LAN (1.5.51): Shanghai Dahua TM-A / TM-F (TM-30F) take PLUs over
 * TCP port 4001, one "!0V" line per good. The TM-30F reads the name as 3 digits per character
 * (1.5.57: its diagnostics took "065066049050" and refused every name whose digits did not
 * divide by 3); it answers "0v<plu>a0" when it stores a line and sends a refused line back. The barcode format (prefix + 5-digit PLU + 5-digit grams + check) is set
 * on the scale itself; the till reads it through scaleBarcodeRules (prefixes 20-29).
 */
const net = require('node:net');
const os = require('node:os');

const PORT = 4001;
const MAX_PLU = 4000; // TM-A / TM-F hold PLU 1..4000
const LATIN = { ə: 'e', Ə: 'E', ş: 's', Ş: 'S', ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U' };
const CYRILLIC = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

/** GB2312 qu-wei digits: ASCII as full-width (row 03), Russian letters (row 07), Azerbaijani letters as Latin. */
function quwei(text) {
  let out = '';
  for (const raw of [...String(text).slice(0, 30)]) {
    const ch = LATIN[raw] ?? raw;
    const code = ch.charCodeAt(0);
    const upper = CYRILLIC.indexOf(ch), lower = CYRILLIC.indexOf(ch.toUpperCase());
    if (ch === ' ') out += '0101';
    else if (code > 0x20 && code < 0x7f) out += '03' + String(code - 0x20).padStart(2, '0');
    else if (upper >= 0) out += '07' + String(upper + 1).padStart(2, '0');
    else if (lower >= 0) out += '07' + String(lower + 49).padStart(2, '0');
    else out += '0331'; // ?
  }
  return out;
}

/** The name as the TM-30F reads it: 3 decimal digits per character (ASCII, Russian as CP1251). */
function codes3(text) {
  let out = '';
  for (const raw of [...String(text).slice(0, 30)]) {
    const ch = LATIN[raw] ?? raw;
    const code = ch.charCodeAt(0);
    const upper = CYRILLIC.indexOf(ch), lower = CYRILLIC.indexOf(ch.toUpperCase());
    let byte = 63; // ?
    if (code >= 0x20 && code < 0x7f) byte = code;
    else if (ch === 'Ё') byte = 168;
    else if (ch === 'ё') byte = 184;
    else if (upper >= 0) byte = 192 + CYRILLIC.replace('Ё', '').indexOf(ch);
    else if (lower >= 0) byte = 224 + CYRILLIC.replace('Ё', '').indexOf(ch.toUpperCase());
    out += String(byte).padStart(3, '0');
  }
  return out;
}

/** One PLU line. Price is per kg in qəpik; prefix lands in the 2-digit shop field the label barcode starts with. */
function pluLine({ plu, name, priceMinor, nameField }, prefix) {
  const n = Number(plu);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PLU) throw new Error(`PLU ${plu}: tərəzi 1–${MAX_PLU} qəbul edir`);
  const price = Number(priceMinor);
  if (!Number.isSafeInteger(price) || price < 0 || price > 999999) throw new Error('Tərəzi qiyməti 0.00–9999.99 AZN aralığında olmalıdır');
  const shop = String(prefix || '20').replace(/\D/g, '').slice(0, 2).padStart(2, '0');
  return `!0V${String(n).padStart(4, '0')}A${String(n).padStart(7, '0')}${String(price).padStart(6, '0')}0000000000${shop}${'0'.repeat(48)}B${nameField ?? codes3(name)}CDE`;
}

/** Weighed goods with a PLU, as scale lines; goods the scale cannot hold come back in `skipped`. */
function scaleLines(goods, prefix) {
  const lines = [], names = [], skipped = [];
  for (const g of goods) {
    if (!Number(g.weighted) || !(Number(g.plu) > 0)) continue;
    try { lines.push(pluLine({ plu: g.plu, name: g.name, priceMinor: g.salePriceMinor }, prefix)); names.push(`${g.name} (PLU ${g.plu})`); }
    catch (error) { skipped.push(`${g.name} (PLU ${g.plu}): ${error.message}`); }
  }
  return { lines, names, skipped };
}

/**
 * One line per connection, as the scale's own tools do: write, wait until its answer has
 * arrived in full (no more bytes for `settleMs`), then close gently. Counting raw TCP chunks
 * and resetting the socket used to cut the PLU line off before the scale stored it.
 */
function sendOne(ip, line, { timeoutMs, settleMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: PORT });
    let reply = '', done = false, settle = null;
    const timer = setTimeout(() => finish(new Error(`${ip} cavab vermədi — bu tərəzi deyil və ya port ${PORT} bağlıdır`)), timeoutMs);
    function finish(error) {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(settle);
      socket.end(); setTimeout(() => socket.destroy(), 1000).unref?.();
      if (error) reject(error); else resolve(reply);
    }
    // Dahua: every command ends CR LF ETX; without the ETX the scale echoes the line and keeps the old PLU.
    socket.on('connect', () => socket.write(line + '\r\n\x03'));
    socket.on('data', (chunk) => { reply += chunk.toString('latin1'); clearTimeout(settle); settle = setTimeout(() => finish(), settleMs); });
    socket.on('error', (error) => finish(new Error(`${ip}:${PORT} — ${error.code || error.message}`)));
    socket.on('close', () => { if (reply) finish(); else finish(new Error(`Tərəzi bağlantını cavabsız kəsdi (${ip})`)); });
  });
}

/** The scale's answer as text, control bytes shown as ␍ ␊ ␃; a long one keeps its start and end. */
function readable(reply) {
  const text = String(reply).replace(/\r/g, '␍').replace(/\n/g, '␊').replace(/\x03/g, '␃').replace(/[\x00-\x1f]/g, '·');
  return text.length > 70 ? `${text.slice(0, 20)} … ${text.slice(-45)} (${text.length} simvol)` : text;
}

/** Sends the lines one by one; stops at the first line the scale does not answer. */
async function sendLines(ip, lines, { timeoutMs = 4000, settleMs = 300 } = {}) {
  if (!net.isIPv4(String(ip))) throw new Error('Tərəzinin IP ünvanı düzgün deyil');
  const replies = [];
  for (const line of lines) {
    try { replies.push(await sendOne(ip, line, { timeoutMs, settleMs })); }
    catch (error) { throw new Error(replies.length ? `${replies.length}/${lines.length} göndərildi, sonra: ${error.message}` : error.message); }
  }
  const rejected = replies.map((r, i) => (accepted(r) ? -1 : i)).filter((i) => i >= 0);
  return { sent: replies.length, accepted: replies.length - rejected.length, rejected, replies, reply: readable(replies.at(-1) ?? '') };
}

/** TM-30F stores a PLU and answers "0v<plu>a0"; a line it cannot take comes back unchanged. */
const accepted = (reply) => /^\d+v\d{4}a/.test(String(reply));

function portOpen(ip, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: PORT });
    const end = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => end(false));
    socket.on('connect', () => end(true));
    socket.on('error', () => end(false));
  });
}

// ponytail: scans this PC's own /24 only; shops with wider subnets type the IP.
async function scan({ timeoutMs = 700 } = {}) {
  const mine = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const hosts = new Set();
  for (const addr of mine) {
    const base = addr.split('.').slice(0, 3).join('.');
    for (let i = 1; i < 255; i += 1) if (`${base}.${i}` !== addr) hosts.add(`${base}.${i}`);
  }
  const list = [...hosts], found = [];
  for (let i = 0; i < list.length; i += 128) {
    const part = list.slice(i, i + 128);
    const open = await Promise.all(part.map((ip) => portOpen(ip, timeoutMs)));
    part.forEach((ip, j) => { if (open[j]) found.push(ip); });
  }
  return { networks: mine, found };
}

const hex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const ascii = (buf) => [...buf].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
const clip = (text, n = 60) => (text.length > 2 * n ? `${text.slice(0, n)} ... ${text.slice(-n)}` : text);

/** Connects, optionally writes, and records every byte the scale sends until it goes quiet. */
function exchange(ip, payload, { quietMs = 1500, firstMs = 3000, holdMs = 0 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now(), chunks = [];
    const out = { connectMs: null, chunks, error: '', closedBy: 'us' };
    const socket = net.createConnection({ host: ip, port: PORT });
    let timer = null, done = false;
    const finish = () => {
      if (done) return;
      done = true; clearTimeout(timer); clearTimeout(cap);
      socket.end(); setTimeout(() => socket.destroy(), 500).unref?.();
      resolve(out);
    };
    const cap = setTimeout(finish, 10000);
    socket.on('connect', () => {
      out.connectMs = Date.now() - started;
      if (payload) socket.write(payload);
      timer = setTimeout(finish, firstMs + holdMs);
    });
    socket.on('data', (buf) => {
      chunks.push({ t: Date.now() - started, buf });
      clearTimeout(timer); timer = setTimeout(finish, quietMs + holdMs);
    });
    socket.on('error', (e) => { out.error = e.code || e.message; finish(); });
    socket.on('close', () => { if (!done) { out.closedBy = 'scale'; finish(); } });
  });
}

function describe(log, res, sent) {
  if (res.connectMs === null) { log.push(`  connect FAILED: ${res.error || 'timeout'}`); return; }
  log.push(`  connect ${res.connectMs} ms${res.error ? `, error ${res.error}` : ''}, closed by ${res.closedBy}`);
  if (!res.chunks.length) { log.push('  received: nothing'); return; }
  for (const c of res.chunks) log.push(`  recv +${c.t} ms, ${c.buf.length} bytes: ${clip(ascii(c.buf))}`, `    hex: ${clip(hex(c.buf), 48)}`);
  const all = Buffer.concat(res.chunks.map((c) => c.buf));
  if (sent) log.push(`  reply equals what was sent (echo): ${all.equals(sent) ? 'YES' : 'no'} (sent ${sent.length}, got ${all.length} bytes)`);
}

/**
 * Tries the PLU command in several framings, each on its own free PLU named TEST A, TEST B...
 * Whichever PLU the scale then shows tells which framing it stores. Everything is logged in ASCII.
 */
async function diagnose({ ip, prefix, goods = [], header = [] }) {
  const log = ['POSSISTEM scale diagnostics', ...header, `target ${ip}:${PORT}, barcode prefix ${prefix}`,
    `this PC IPv4: ${Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address).join(', ') || 'none'}`];
  if (!net.isIPv4(String(ip))) { log.push('IP is not valid'); return { log: log.join('\n'), plus: [] }; }
  log.push('', '--- 1. connect and only listen (does the scale greet?)');
  describe(log, await exchange(ip, null, { firstMs: 2500 }), null);

  const taken = new Set(goods.map((g) => Number(g.plu)));
  const free = [];
  for (let p = MAX_PLU; p > 0 && free.length < 8; p -= 1) if (!taken.has(p)) free.push(p);
  // The name field is 3 digits per character; runs of codes show which character each code draws.
  const run3 = (from, n) => Array.from({ length: n }, (_, k) => String(from + k).padStart(3, '0')).join('');
  const names = [
    ['T1', 'ABCDEFGHIJ', 'codes 065-074 (ASCII A-J)', run3(65, 10)],
    ['T2', 'abcdefghij', 'codes 097-106 (ASCII a-j)', run3(97, 10)],
    ['T3', '0123456789', 'codes 048-057 (ASCII digits)', run3(48, 10)],
    ['T4', 'codes 128-137', 'codes 128-137', run3(128, 10)],
    ['T5', 'codes 192-201', 'codes 192-201 (CP1251: ABVGDEJZIY in Russian)', run3(192, 10)],
    ['T6', 'codes 224-233', 'codes 224-233 (CP1251: Russian lowercase)', run3(224, 10)],
    ['T7', 'codes 246-255', 'codes 246-255 (CP1254: o-umlaut ... s-cedilla)', run3(246, 10)],
    ['T8', 'ABCDEFGHIJKLMNOPQRSTUVWX', '24 letters (longest name?)', run3(65, 24)],
  ];
  const plus = [];
  const run = async (label, title, text, sent) => {
    log.push('', `--- ${label}. ${title}`, `  sent ${sent.length} bytes: ${clip(ascii(sent))}`, `    hex: ${clip(hex(sent), 48)}`);
    const res = await exchange(ip, sent, {});
    describe(log, res, sent);
    const all = Buffer.concat(res.chunks.map((c) => c.buf)).toString('latin1');
    const verdict = accepted(all) ? 'ACCEPTED (short answer)' : all.startsWith('!') ? 'REJECTED (line came back)' : `UNKNOWN answer`;
    log.push(`  => ${verdict}`);
    plus.push(`${label} = ${text} -> ${verdict}`);
  };
  for (const [i, [key, text, title, field]] of names.entries()) {
    const line = pluLine({ plu: free[i], name: '', priceMinor: 101 + i, nameField: field }, prefix);
    await run(key, `PLU ${free[i]}, name "${text}" as ${title}, price 1.0${1 + i}`, `PLU ${free[i]} should read "${text}" (1.0${1 + i} AZN)`, Buffer.from(line + '\r\n\x03', 'latin1'));
  }
  // The first weighed good exactly as "send all" sends it (3 digits per character).
  const good = goods.find((g) => Number(g.weighted) && Number(g.plu) > 0 && Number(g.plu) <= MAX_PLU);
  if (good) {
    const plain = (t) => [...String(t)].map((c) => ({ ə: 'e', Ə: 'E', ş: 's', Ş: 'S', ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U' }[c] ?? c)).join('');
    for (const [key, name, title] of [['R1', good.name, 'as "send all" sends it']]) {
      const line = pluLine({ plu: good.plu, name, priceMinor: good.salePriceMinor }, prefix);
      await run(key, `your good PLU ${good.plu} "${plain(name)}", ${title}`, `PLU ${good.plu} should read "${plain(name)}"`, Buffer.from(line + '\r\n\x03', 'latin1'));
    }
  } else log.push('', '--- R. no weighed good with a PLU 1-4000 to try');
  log.push('', 'NOW ON THE SCALE: type each PLU below + PLU key and write next to it EXACTLY what the scale shows', '(every character of the name, and the price; a photo of the screen is even better):', ...plus.map((p) => `  ${p}`));
  return { log: log.join('\n'), plus };
}

/** The highest PLU not taken by a good, for the test label. */
function testPlu(goods) {
  const taken = new Set(goods.map((g) => Number(g.plu)));
  for (let p = MAX_PLU; p > 0; p -= 1) if (!taken.has(p)) return p;
  return MAX_PLU;
}

module.exports = { PORT, MAX_PLU, quwei, codes3, readable, accepted, diagnose, pluLine, scaleLines, sendLines, scan, testPlu };
