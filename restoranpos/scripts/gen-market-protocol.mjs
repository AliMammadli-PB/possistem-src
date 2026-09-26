#!/usr/bin/env node
/**
 * Generates TS + C++ views of market-pos/shared/contracts/protocol.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR } from './pos-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET = APP_DIR;
const SPEC = JSON.parse(fs.readFileSync(path.join(MARKET, 'shared', 'contracts', 'protocol.json'), 'utf8'));

const BANNER = `/**
 * AUTO-GENERATED from market-pos/shared/contracts/protocol.json - DO NOT EDIT.
 * Regenerate with: node scripts/gen-market-protocol.mjs
 */`;

function pascal(raw) {
  return raw
    .replace(/^E_/, '')
    .split(/[_.\-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

const errorNames = Object.keys(SPEC.errors);
const methodNames = Object.keys(SPEC.methods).filter((m) => !m.startsWith('$'));
const eventNames = Object.keys(SPEC.events);

const tsOut = path.join(MARKET, 'shared', 'contracts', 'protocol.generated.ts');
const hppOut = path.join(MARKET, 'native', 'core', 'include', 'market', 'protocol_generated.hpp');

const ts = [BANNER, ''];
ts.push(`export const PROTOCOL_VERSION = ${SPEC.protocolVersion} as const;`, '');
ts.push('export type ErrorCode =');
for (const e of errorNames) ts.push(`  | '${e}'`);
ts.push(';', '');
ts.push('export type MethodName =');
for (const m of methodNames) ts.push(`  | '${m}'`);
ts.push(';', '');
ts.push('export type EventName =');
for (const e of eventNames) ts.push(`  | '${e}'`);
ts.push(';', '');
ts.push('export const ERROR_CODES = [');
for (const e of errorNames) ts.push(`  '${e}',`);
ts.push('] as const;', '');
ts.push('export const METHOD_NAMES = [');
for (const m of methodNames) ts.push(`  '${m}',`);
ts.push('] as const;', '');
ts.push('export const METHOD_META: Record<MethodName, { description?: string }> = {');
for (const m of methodNames) {
  const d = SPEC.methods[m]?.description ? JSON.stringify(SPEC.methods[m].description) : 'undefined';
  ts.push(`  '${m}': { description: ${d} },`);
}
ts.push('};', '');

fs.mkdirSync(path.dirname(tsOut), { recursive: true });
fs.writeFileSync(tsOut, ts.join('\n'), 'utf8');

const hpp = [BANNER, '#pragma once', '#include <string_view>', 'namespace market::protocol {', `inline constexpr int kVersion = ${SPEC.protocolVersion};`, 'namespace errors {'];
for (const e of errorNames) {
  hpp.push(`inline constexpr std::string_view ${pascal(e)} = "${e}";`);
}
hpp.push('}  // namespace errors', 'inline constexpr std::string_view kMethods[] = {');
for (const m of methodNames) hpp.push(`  "${m}",`);
hpp.push('};', `inline constexpr std::size_t kMethodCount = ${methodNames.length};`, '}  // namespace market::protocol', '');

fs.mkdirSync(path.dirname(hppOut), { recursive: true });
fs.writeFileSync(hppOut, hpp.join('\n'), 'utf8');

process.stdout.write(`[gen-market-protocol] ${methodNames.length} methods, ${errorNames.length} errors\n`);
