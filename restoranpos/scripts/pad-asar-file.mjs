#!/usr/bin/env node
/**
 * Size-match a file for in-place asar overwrite.
 * HTML must be padded with an HTML comment or spaces — never /* *\/
 * after </html> (Chromium paints that as BODY text).
 */
import fs from 'node:fs';

const file = process.argv[2];
const target = Number(process.argv[3]);
if (!file || !Number.isFinite(target) || target < 0) {
  console.error('usage: node pad-asar-file.mjs <file> <targetBytes>');
  process.exit(1);
}

const buf = fs.readFileSync(file);
if (buf.length > target) {
  console.error(`error: ${file} is ${buf.length} bytes, larger than ${target}`);
  process.exit(1);
}
if (buf.length === target) {
  console.log('already sized', file, target);
  process.exit(0);
}

const need = target - buf.length;
const html = file.endsWith('.html') || file.endsWith('.htm');
let pad;
if (html) {
  if (need < 8) pad = Buffer.alloc(need, 32);
  else pad = Buffer.from(`<!--${' '.repeat(need - 7)}-->`);
} else {
  if (need < 5) pad = Buffer.alloc(need, 32);
  else pad = Buffer.from(`/*${' '.repeat(need - 4)}*/`);
}

const out = Buffer.concat([buf, pad]);
if (out.length !== target) {
  console.error('error: pad length mismatch', out.length, target);
  process.exit(1);
}
if (html && /<\/html>[\s\S]*\/\*/i.test(out.toString('utf8'))) {
  console.error('error: HTML would contain JS comment after </html>');
  process.exit(1);
}
fs.writeFileSync(file, out);
console.log('padded', file, buf.length, '->', target, html ? 'html-comment' : 'c-comment');
