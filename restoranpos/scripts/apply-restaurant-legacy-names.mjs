#!/usr/bin/env node
/**
 * Old names that still reached the network from the restaurant main process:
 *  - requests to the control API identified the till as `OfflinePOS/<version>`;
 *  - "Ödəniş" opened https://cyberplus.az/contact when a licence carried no
 *    payment link (a retired domain);
 *  - links the till may open allowed offlinegame.az next to possistem.az.
 * The list of retired control hosts (old IP, cyberplus.az, offlinegame.az) is
 * kept on purpose: it stops a till from being pointed back at them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_LEGACY_NAMES_v1 */';

function replaceCount(src, find, repl, expected, label) {
  const n = src.split(find).length - 1;
  if (n !== expected) throw new Error(`${label}: expected ${expected} match(es), got ${n}`);
  return src.split(find).join(repl);
}

let main = fs.readFileSync(MAIN, 'utf8');
if (!main.includes(MARK)) {
  main = replaceCount(main, 'OfflinePOS/${c.app.getVersion()}', 'possistem-Restoran/${c.app.getVersion()}', 2, 'user agent');
  main = replaceCount(main, '"https://cyberplus.az/contact"', `${MARK}"https://possistem.az/#elaqe"`, 1, 'payment fallback');
  main = replaceCount(main, '/^https:\\/\\/(possistem\\.az|offlinegame\\.az)\\//i', '/^https:\\/\\/possistem\\.az\\//i', 1, 'external links');
  fs.writeFileSync(MAIN, main);
  console.log('legacy names replaced', MAIN);
}
