#!/usr/bin/env node
/**
 * Embeds market-pos/database/migrations/*.sql (+ seed) into a C++ header.
 * -> market-pos/native/core/include/market/db/migrations_generated.hpp
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'marketpos');
const MIGRATIONS_DIR = path.join(MARKET, 'database', 'migrations');
const SEED_DIR = path.join(MARKET, 'database', 'seed');
const OUT = path.join(MARKET, 'native', 'core', 'include', 'market', 'db', 'migrations_generated.hpp');

function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function readSqlDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      const match = /^(\d+)/.exec(file);
      return { version: match ? Number(match[1]) : 0, name: file, sql: text, checksum: checksum(text) };
    });
}

function cppStringLiteral(sql) {
  // R"market(... )market" — avoid terminator in SQL
  if (sql.includes(')market"')) throw new Error('SQL contains forbidden raw-string terminator');
  return `R"market(${sql})market"`;
}

const migrations = readSqlDir(MIGRATIONS_DIR);
const seeds = readSqlDir(SEED_DIR);
const schemaVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const lines = [];
lines.push('/**');
lines.push(' * AUTO-GENERATED from market-pos/database/migrations - DO NOT EDIT.');
lines.push(' * Regenerate with: node scripts/gen-market-migrations.mjs');
lines.push(' */');
lines.push('#pragma once');
lines.push('#include <cstddef>');
lines.push('#include <string_view>');
lines.push('namespace market::db {');
lines.push(`inline constexpr int kSchemaVersion = ${schemaVersion};`);
lines.push('struct EmbeddedMigration { int version; const char* name; const char* checksum; std::string_view sql; };');
lines.push(`inline constexpr EmbeddedMigration kMigrations[] = {`);
for (const m of migrations) {
  lines.push(`  {${m.version}, "${m.name}", "${m.checksum}", ${cppStringLiteral(m.sql)}},`);
}
lines.push('};');
lines.push(`inline constexpr std::size_t kMigrationCount = ${migrations.length};`);
lines.push('struct EmbeddedSeed { const char* name; std::string_view sql; };');
lines.push('inline constexpr EmbeddedSeed kSeeds[] = {');
for (const s of seeds) {
  lines.push(`  {"${s.name}", ${cppStringLiteral(s.sql)}},`);
}
lines.push('};');
lines.push(`inline constexpr std::size_t kSeedCount = ${seeds.length};`);
lines.push('}  // namespace market::db');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
process.stdout.write(`[gen-market-migrations] wrote ${migrations.length} migrations (v${schemaVersion}), ${seeds.length} seeds → ${path.relative(path.join(MARKET, '..'), OUT)}\n`);
