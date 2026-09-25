#!/usr/bin/env node
/**
 * Generates the TypeScript and C++ views of shared/contracts/protocol.json.
 *
 * Error codes, method names and enum spellings have to agree byte-for-byte
 * across the Electron/C++ boundary. Maintaining two hand-written lists is a
 * guaranteed source of silent drift, so both are derived from one file.
 *
 *   shared/contracts/protocol.generated.ts
 *   native/core/include/pos/protocol_generated.hpp
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'shared', 'contracts', 'protocol.json'), 'utf8'),
);

const BANNER = `/**
 * AUTO-GENERATED from shared/contracts/protocol.json - DO NOT EDIT.
 * Regenerate with: node scripts/gen-protocol.mjs
 */`;

/** E_ORDER_NOT_FOUND -> OrderNotFound ; waiting_for_terminal -> WaitingForTerminal */
function pascal(raw) {
  return raw
    .replace(/^E_/, '')
    .split(/[_.\-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** orders.addItem -> OrdersAddItem */
function methodIdent(raw) {
  return raw
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function camelLimit(key) {
  return 'k' + key.charAt(0).toUpperCase() + key.slice(1);
}

const errorNames = Object.keys(SPEC.errors);
const methodNames = Object.keys(SPEC.methods).filter((m) => !m.startsWith('$'));
const eventNames = Object.keys(SPEC.events);
const enumNames = Object.keys(SPEC.enums);

// ---------------------------------------------------------------- TypeScript

function genTypeScript() {
  const out = [BANNER, ''];

  out.push(`export const PROTOCOL_VERSION = ${SPEC.protocolVersion} as const;`, '');

  out.push('export const LIMITS = {');
  for (const [k, v] of Object.entries(SPEC.limits)) {
    out.push(`  ${k}: ${JSON.stringify(v)},`);
  }
  out.push('} as const;', '');

  // Errors
  out.push('export const ERROR_CODES = [');
  for (const e of errorNames) out.push(`  '${e}',`);
  out.push('] as const;');
  out.push('export type ErrorCode = (typeof ERROR_CODES)[number];', '');

  out.push(
    'export interface ErrorMeta { retryable: boolean; message: string; fatal: boolean }',
    'export const ERROR_META: Record<ErrorCode, ErrorMeta> = {',
  );
  for (const [code, meta] of Object.entries(SPEC.errors)) {
    out.push(
      `  ${code}: { retryable: ${!!meta.retryable}, message: ${JSON.stringify(
        meta.message,
      )}, fatal: ${!!meta.fatal} },`,
    );
  }
  out.push('};', '');

  out.push(
    'export function isErrorCode(v: unknown): v is ErrorCode {',
    '  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ERROR_META, v);',
    '}',
    '',
  );

  // Methods
  out.push('export const METHODS = [');
  for (const m of methodNames) out.push(`  '${m}',`);
  out.push('] as const;');
  out.push('export type MethodName = (typeof METHODS)[number];', '');

  out.push(
    'export interface MethodMeta { auth: boolean; perm: string | null; timeout: number; idempotent: boolean }',
    'export const METHOD_META: Record<MethodName, MethodMeta> = {',
  );
  for (const [name, meta] of Object.entries(SPEC.methods)) {
    if (name.startsWith('$')) continue;
    const timeout = meta.timeout ?? SPEC.limits.defaultTimeoutMs;
    out.push(
      `  '${name}': { auth: ${!!meta.auth}, perm: ${
        meta.perm ? `'${meta.perm}'` : 'null'
      }, timeout: ${timeout}, idempotent: ${!!meta.idempotent} },`,
    );
  }
  out.push('};', '');

  // Events
  out.push('export const EVENTS = [');
  for (const e of eventNames) out.push(`  '${e}',`);
  out.push('] as const;');
  out.push('export type EventName = (typeof EVENTS)[number];', '');

  // Enums
  for (const name of enumNames) {
    const values = SPEC.enums[name];
    const constName = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() + 'S';
    out.push(`export const ${constName} = [${values.map((v) => `'${v}'`).join(', ')}] as const;`);
    out.push(`export type ${name} = (typeof ${constName})[number];`, '');
  }

  // Permissions
  out.push('export const PERMISSIONS = {');
  for (const [perm, roles] of Object.entries(SPEC.permissions)) {
    out.push(`  '${perm}': [${roles.map((r) => `'${r}'`).join(', ')}],`);
  }
  out.push('} as const;');
  out.push('export type PermissionKey = keyof typeof PERMISSIONS;', '');

  out.push(
    'export function roleHasPermission(role: Role, perm: PermissionKey): boolean {',
    '  return (PERMISSIONS[perm] as readonly string[]).includes(role);',
    '}',
    '',
  );

  return out.join('\n');
}

// ----------------------------------------------------------------------- C++

function genCpp() {
  const out = [
    '// clang-format off',
    '// AUTO-GENERATED from shared/contracts/protocol.json - DO NOT EDIT.',
    '// Regenerate with: node scripts/gen-protocol.mjs',
    '#pragma once',
    '',
    '#include <array>',
    '#include <cstdint>',
    '#include <string>',
    '#include <string_view>',
    '',
    'namespace pos::protocol {',
    '',
    `inline constexpr int kProtocolVersion = ${SPEC.protocolVersion};`,
    '',
    'namespace limits {',
  ];

  for (const [k, v] of Object.entries(SPEC.limits)) {
    if (Array.isArray(v)) {
      out.push(
        `inline constexpr std::array<std::int64_t, ${v.length}> ${camelLimit(k)}{${v.join(', ')}};`,
      );
    } else {
      out.push(`inline constexpr std::int64_t ${camelLimit(k)} = ${v};`);
    }
  }
  out.push('}  // namespace limits', '');

  // Error codes as string constants
  out.push('namespace err {');
  for (const code of errorNames) {
    out.push(`inline constexpr std::string_view k${pascal(code)} = "${code}";`);
  }
  out.push('}  // namespace err', '');

  out.push(
    'struct ErrorMeta { std::string_view code; bool retryable; bool fatal; std::string_view message; };',
    `inline constexpr std::array<ErrorMeta, ${errorNames.length}> kErrorTable{{`,
  );
  for (const [code, meta] of Object.entries(SPEC.errors)) {
    out.push(
      `    {"${code}", ${!!meta.retryable}, ${!!meta.fatal}, ${JSON.stringify(meta.message)}},`,
    );
  }
  out.push('}};', '');

  out.push(
    'inline const ErrorMeta* findError(std::string_view code) {',
    '    for (const auto& e : kErrorTable) { if (e.code == code) return &e; }',
    '    return nullptr;',
    '}',
    '',
    'inline bool isRetryable(std::string_view code) {',
    '    const auto* m = findError(code); return m && m->retryable;',
    '}',
    '',
  );

  // Methods
  out.push('namespace method {');
  for (const m of methodNames) {
    out.push(`inline constexpr std::string_view k${methodIdent(m)} = "${m}";`);
  }
  out.push('}  // namespace method', '');

  // Events
  out.push('namespace event {');
  for (const e of eventNames) {
    out.push(`inline constexpr std::string_view k${methodIdent(e)} = "${e}";`);
  }
  out.push('}  // namespace event', '');

  // Enums: enum class + to_string + parse
  for (const name of enumNames) {
    const values = SPEC.enums[name];
    out.push(`enum class ${name} : std::uint8_t {`);
    for (const v of values) out.push(`    ${pascal(v)},`);
    out.push('};', '');

    out.push(
      `inline constexpr std::array<std::string_view, ${values.length}> k${name}Names{{`,
      `    ${values.map((v) => `"${v}"`).join(', ')}`,
      '}};',
      '',
      `inline std::string_view toString(${name} v) {`,
      `    return k${name}Names[static_cast<std::size_t>(v)];`,
      '}',
      '',
      `inline bool parse${name}(std::string_view s, ${name}& out) {`,
      `    for (std::size_t i = 0; i < k${name}Names.size(); ++i) {`,
      `        if (k${name}Names[i] == s) { out = static_cast<${name}>(i); return true; }`,
      '    }',
      '    return false;',
      '}',
      '',
    );
  }

  out.push('}  // namespace pos::protocol');
  out.push('// clang-format on');
  return out.join('\n') + '\n';
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (existing === content) {
    process.stdout.write(`[gen-protocol] ${path.relative(ROOT, file)} up to date\n`);
    return;
  }
  fs.writeFileSync(file, content, 'utf8');
  process.stdout.write(`[gen-protocol] wrote ${path.relative(ROOT, file)}\n`);
}

write(path.join(ROOT, 'shared', 'contracts', 'protocol.generated.ts'), genTypeScript());
write(path.join(ROOT, 'native', 'core', 'include', 'pos', 'protocol_generated.hpp'), genCpp());

process.stdout.write(
  `[gen-protocol] ${errorNames.length} errors, ${methodNames.length} methods, ` +
    `${eventNames.length} events, ${enumNames.length} enums\n`,
);
