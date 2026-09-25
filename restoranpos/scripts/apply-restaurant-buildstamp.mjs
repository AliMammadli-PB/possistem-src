#!/usr/bin/env node
/**
 * Shows which build the window is actually running.
 *
 * This till is patched on every launch and the bundle keeps the same filename,
 * so "did my change land?" has no answer from inside the app - a window left
 * open from before a patch looks identical to one started after it. That cost
 * a full round trip: the fix was on disk, the old text existed in no file on
 * the machine, and the screen still showed the old text, because the window
 * predated the patch.
 *
 * A stamp under the operator's name settles it at a glance: the app version plus
 * a short hash of every patch input (the apply scripts and their admin-ui
 * sources). The version alone does not move when a patch script does; the hash
 * does, and unlike a wall-clock time it is identical for identical inputs, so
 * the assembled build stays reproducible.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function patchInputsHash() {
  const hash = createHash('sha256');
  const scripts = path.join(ROOT, 'scripts');
  const adminUi = path.join(scripts, 'admin-ui');
  const files = [
    ...fs.readdirSync(scripts).filter((f) => /^apply-restaurant-.*\.mjs$/.test(f)).map((f) => path.join(scripts, f)),
    ...fs.readdirSync(adminUi).filter((f) => !f.includes('.bak-')).map((f) => path.join(adminUi, f)),
  ].sort();
  for (const file of files) {
    hash.update(path.relative(ROOT, file).replace(/\\/g, '/')).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return hash.digest('hex').slice(0, 7);
}

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const stamp = `${version} · ${patchInputsHash()}`;

let s = fs.readFileSync(BUNDLE, 'utf8');
const before = s;

// --- the constant: replaced every run so it tracks the last patch ---------
const decl = /const _PS_BUILD = "[^"]*";\n/;
if (decl.test(s)) {
  s = s.replace(decl, `const _PS_BUILD = "${stamp}";\n`);
} else {
  const anchor = 'function AppShell() {';
  must(s.split(anchor).length - 1 === 1, 'AppShell anchor not unique');
  s = s.replace(anchor, `const _PS_BUILD = "${stamp}";\n${anchor}`);
}

// --- the line, under the operator's role ----------------------------------
if (!s.includes('_PS_BUILD }')) {
  const roleLine = `            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-faint", children: t.roles[session.role] ?? session.role })`;
  must(s.split(roleLine).length - 1 === 1, 'sidebar role line not unique');
  s = s.replace(
    roleLine,
    `${roleLine},
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 truncate text-[9px] tracking-[0.08em] text-faint/70", children: _PS_BUILD })`,
  );
  console.log('added the build line to the sidebar');
}

if (s !== before) fs.writeFileSync(BUNDLE, s);

must(s.includes(`const _PS_BUILD = "${stamp}";`), 'stamp not written');
must(s.includes('children: _PS_BUILD }'), 'stamp not rendered');
must(s.split('const _PS_BUILD =').length - 1 === 1, 'more than one stamp declaration');

console.log(`build stamp ${stamp}`);
