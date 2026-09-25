#!/usr/bin/env node
/**
 * Stages hashed table/category PNGs next to the restaurant bundle.
 * Floor tiles stay solid status colors — no photos on tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const STAGE_ASSETS = path.join(ROOT, 'packaged-renderer', 'assets');
const HASHED_SRC = path.join(ROOT, 'packaged-renderer', 'assets');
const MARK = '/* POS_TABLE_PHOTO_v1 */';
const CSS_MARK = '/* POS_TABLE_PHOTO_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  s = MARK + '\n' + s;
  fs.writeFileSync(BUNDLE, s);
  console.log('marked', BUNDLE);
} else {
  console.log('bundle already applied');
}

let css = fs.readFileSync(CSS, 'utf8');
if (css.includes(CSS_MARK)) {
  console.log('css already applied');
} else {
  css += `\n${CSS_MARK}\n`;
  fs.writeFileSync(CSS, css);
  console.log('patched', CSS);
}

fs.mkdirSync(STAGE_ASSETS, { recursive: true });
const names = [...s.matchAll(/new URL\("((?:[0-9]{2}|cat)-[^"]+\.png)"/g)].map((m) => m[1]);
must(names.length >= 50, `expected hashed table+cat urls, got ${names.length}`);
let copied = 0;
for (const name of names) {
  const to = path.join(STAGE_ASSETS, name);
  if (fs.existsSync(to)) {
    copied += 1;
    continue;
  }
  const from = path.join(HASHED_SRC, name);
  if (!fs.existsSync(from)) throw new Error(`missing hashed asset ${name}`);
  fs.copyFileSync(from, to);
  copied += 1;
}
console.log('staged hashed visuals', copied);
