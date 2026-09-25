#!/usr/bin/env node
/**
 * Teaches main about the methods the core actually speaks.
 *
 * Main gates every IPC call on a baked-in table (`Cn` in the bundled
 * index.js): `const i = Cn[s]; if (!i) return E_UNKNOWN_METHOD`. That table
 * was generated from shared/contracts/protocol.json at some earlier build and
 * then frozen into the shipped bundle - so every method added to the contract
 * since (inventory, suppliers, guests, reservations, delivery, roster, roles,
 * report export) was rejected by main before it ever reached the core.
 *
 * The symptom is silent: the renderer's call fails, a panel that guards on
 * `if (!data) return null` renders nothing, and the feature looks absent
 * rather than broken. That is how the roles panel went missing.
 *
 * protocol.json is the source of truth. This adds whatever it lists and main
 * lacks, and never touches an entry that is already there - the 145 working
 * methods keep the timeouts they shipped with.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const PROTOCOL = path.join(ROOT, 'shared/contracts/protocol.json');

/** Main-only methods: handled in main's own switch, never forwarded to the core. */
const MAIN_ONLY = {
  'files.saveText': { auth: true, perm: null, timeout: 30000, idempotent: false },
  'files.savePdf': { auth: true, perm: null, timeout: 60000, idempotent: false },
};

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** `Cn` is minified output: booleans are !0/!1 and 3000 is 3e3. Match it. */
function bool(v) {
  return v ? '!0' : '!1';
}
function num(v) {
  const exp = String(v).match(/^([1-9])(0+)$/);
  return exp && Number(exp[2].length) >= 3 ? `${exp[1]}e${exp[2].length}` : String(v);
}
function entry(name, spec) {
  const perm = spec.perm ? JSON.stringify(spec.perm) : 'null';
  return `${JSON.stringify(name)}:{auth:${bool(spec.auth ?? false)},perm:${perm},` +
    `timeout:${num(spec.timeout ?? 3000)},idempotent:${bool(spec.idempotent ?? false)}}`;
}

const protocol = JSON.parse(fs.readFileSync(PROTOCOL, 'utf8'));
must(protocol.methods && typeof protocol.methods === 'object', 'protocol.json has no methods map');

let s = fs.readFileSync(MAIN, 'utf8');

const head = 'Cn={';

/** The table is one object literal in minified output; walk to its own `}`. */
function tableBounds(src) {
  const open = src.indexOf(head);
  must(open !== -1, 'method table not found in main');
  let depth = 0;
  for (let i = open + head.length - 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"') {
      i += 1;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { open, close: i + 1 };
    }
  }
  throw new Error('method table end not found');
}

const { open, close } = tableBounds(s);
const table = s.slice(open, close);

const wanted = new Map();
const internal = [];
for (const [name, spec] of Object.entries(protocol.methods)) {
  if (name.startsWith('$')) continue; // $comment keys document sections
  // `internal` methods are main's own privileged calls into the core. Main
  // reaches the core directly, bypassing this table; the table is only the
  // door the RENDERER comes through. Adding one here would hand the till UI a
  // method the core answers without checking a single permission.
  if (spec && spec.internal) {
    internal.push(name);
    continue;
  }
  wanted.set(name, spec ?? {});
}
for (const [name, spec] of Object.entries(MAIN_ONLY)) wanted.set(name, spec);

const missing = [...wanted].filter(([name]) => !table.includes(`${JSON.stringify(name)}:{auth:`));

if (missing.length > 0) {
  // Insert right after the opening `Cn={` so no existing entry's text moves;
  // later patches anchor on those strings.
  const additions = missing.map(([name, spec]) => entry(name, spec)).join(',');
  s = s.slice(0, open) + head + additions + ',' + s.slice(open + head.length);
  fs.writeFileSync(MAIN, s);
}

// Verify every run, not just the one that writes - a half-applied table is the
// failure this script exists to prevent.
const bounds = tableBounds(s);
const after = s.slice(bounds.open, bounds.close);
// Evaluates the method-gate object literal of this repository's own bundle at
// build time - never external input.
// eslint-disable-next-line no-new-func
const parsed = new Function(`return ${after.slice(head.length - 1)}`)();
for (const [name] of wanted) must(parsed[name], `${name} still missing from the gate`);
for (const anchor of ['core.ping', 'auth.login', 'orders.create', 'orders.close']) {
  must(parsed[anchor], `${anchor} lost from the gate`);
}
for (const name of internal) {
  must(!parsed[name], `${name} is internal but the renderer can reach it`);
}
must(
  Object.keys(parsed).length >= wanted.size,
  `gate has ${Object.keys(parsed).length} methods, contract wants ${wanted.size}`,
);

if (missing.length === 0) {
  console.log(`method table already complete (${Object.keys(parsed).length} methods)`);
  process.exit(0);
}
console.log(`patched ${MAIN} (+${missing.length}, now ${Object.keys(parsed).length} methods)`);
for (const [name] of missing) console.log('  +', name);
