#!/usr/bin/env node
/**
 * Replay Write / Edit / StrReplace tool calls from a Claude Code session jsonl
 * onto the current workspace, in chronological order.
 */
import fs from 'node:fs';
import path from 'node:path';

const SESSION =
  process.argv[2] ||
  'C:/Users/canur/.claude/projects/C--Users-canur-Desktop-porjects-restoran-pos/a29df22c-cb62-4540-b1df-0a12c31dbef4.jsonl';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const lines = fs.readFileSync(SESSION, 'utf8').split(/\n/).filter(Boolean);
let applied = 0;
let skipped = 0;
const failures = [];

function normalizePath(p) {
  if (!p) return null;
  let s = String(p).replace(/\//g, path.sep);
  // Already absolute Windows path
  if (/^[A-Za-z]:\\/.test(s)) return s;
  return path.resolve(ROOT, s);
}

function applyOp(op) {
  const filePath = normalizePath(op.path);
  if (!filePath) return;
  if (op.kind === 'write') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, op.contents, 'utf8');
    applied += 1;
    return;
  }
  if (!fs.existsSync(filePath)) {
    skipped += 1;
    failures.push({ filePath, reason: 'missing', op: op.kind });
    return;
  }
  const before = fs.readFileSync(filePath, 'utf8');
  if (!before.includes(op.old_string)) {
    skipped += 1;
    failures.push({
      filePath,
      reason: 'old_string not found',
      op: op.kind,
      preview: op.old_string.slice(0, 80).replace(/\n/g, '\\n'),
    });
    return;
  }
  const after = op.replace_all
    ? before.split(op.old_string).join(op.new_string)
    : before.replace(op.old_string, op.new_string);
  fs.writeFileSync(filePath, after, 'utf8');
  applied += 1;
}

const ops = [];
for (const line of lines) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    continue;
  }
  const content = o.message?.content;
  const parts = Array.isArray(content) ? content : content ? [content] : [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const name = part.name || part.toolName;
    const inp = part.input || part.arguments || {};
    const p = inp.path || inp.file_path || inp.target_notebook;
    if (!p) continue;
    if (name === 'Write' && typeof inp.contents === 'string') {
      ops.push({ kind: 'write', path: p, contents: inp.contents });
    } else if ((name === 'Edit' || name === 'StrReplace') && typeof inp.old_string === 'string') {
      ops.push({
        kind: 'edit',
        path: p,
        old_string: inp.old_string,
        new_string: inp.new_string ?? '',
        replace_all: Boolean(inp.replace_all),
      });
    }
  }
}

console.log(`[replay] ${ops.length} ops from ${SESSION}`);
for (const op of ops) applyOp(op);
console.log(`[replay] applied=${applied} skipped=${skipped}`);
if (failures.length) {
  console.log('[replay] first failures:');
  for (const f of failures.slice(0, 40)) {
    console.log(`  - ${f.filePath}: ${f.reason} (${f.op}) ${f.preview || ''}`);
  }
}
