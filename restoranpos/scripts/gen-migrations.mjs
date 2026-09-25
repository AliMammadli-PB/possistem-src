#!/usr/bin/env node
/**
 * Embeds database/migrations/*.sql and database/seed/*.sql into a C++ header.
 *
 * The .sql files stay the source of truth (readable, diffable, reviewable), but
 * the core compiles them in rather than reading them at runtime. A packaged app
 * that cannot locate its migration directory fails at first launch on the
 * customer's machine, which is the worst possible time to discover a path bug.
 *
 *   -> native/core/include/pos/db/migrations_generated.hpp
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const SEED_DIR = path.join(ROOT, 'database', 'seed');
const OUT = path.join(ROOT, 'native', 'core', 'include', 'pos', 'db', 'migrations_generated.hpp');

/** Simple non-cryptographic checksum, recorded so drift is visible in the table. */
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
            // Normalize CRLF → LF so Windows checkouts don't drift checksums
            // away from databases that applied the same SQL with LF endings.
            const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
            const match = /^(\d+)/.exec(file);
            return {
                version: match ? Number(match[1]) : 0,
                name: file,
                sql: text,
                checksum: checksum(text),
            };
        });
}

const migrations = readSqlDir(MIGRATIONS_DIR);
const seeds = readSqlDir(SEED_DIR);

if (migrations.length === 0) {
    console.error('[gen-migrations] no migrations found in database/migrations');
    process.exit(1);
}

/**
 * MSVC rejects any single string literal over 65535 bytes with C2026, and the
 * schema comfortably exceeds that. So each script is emitted as a sequence of
 * sub-64 KB chunks appended into a std::string at first use.
 *
 * Chunks are split on line boundaries, which keeps the generated header
 * readable and guarantees no SQL token is ever cut in half.
 */
// MSVC documents 65535 bytes for a string literal, but its practical limit for
// *raw* string literals is far lower, so this is deliberately conservative.
const MAX_CHUNK_BYTES = 8000;

function chunkSql(sql) {
    const lines = sql.split('\n');
    const chunks = [];
    let current = '';

    for (const line of lines) {
        if (current.length > 0 && Buffer.byteLength(current) + Buffer.byteLength(line) + 1 > MAX_CHUNK_BYTES) {
            chunks.push(current);
            current = '';
        }
        current += line + '\n';
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

/**
 * Raw string literals need a delimiter that cannot appear in the body.
 * Verified rather than assumed: a collision would produce a baffling C++ error.
 */
function rawLiteral(sql, tag) {
    if (sql.includes(`)${tag}"`)) {
        throw new Error(`SQL contains the raw-string delimiter )${tag}" - change the tag`);
    }
    return `R"${tag}(${sql})${tag}"`;
}

/** Emits a function that assembles one script from its chunks. */
function emitScriptFn(fnName, sql, tag) {
    const chunks = chunkSql(sql);
    const out = [`inline const std::string& ${fnName}() {`, '    static const std::string sql = []{'];
    out.push(`        std::string s;`);
    out.push(`        s.reserve(${Buffer.byteLength(sql) + 16});`);
    for (const chunk of chunks) {
        out.push(`        s += ${rawLiteral(chunk, tag)};`);
    }
    out.push('        return s;', '    }();', '    return sql;', '}', '');
    return { lines: out, chunkCount: chunks.length };
}

const lines = [
    '// AUTO-GENERATED from database/migrations and database/seed - DO NOT EDIT.',
    '// Regenerate with: node scripts/gen-migrations.mjs',
    '#pragma once',
    '',
    '#include <array>',
    '#include <string>',
    '#include <string_view>',
    '',
    'namespace pos::db {',
    '',
    'struct EmbeddedScript {',
    '    int version;',
    '    std::string_view name;',
    '    std::string_view checksum;',
    '    // Assembled on first call: MSVC caps a single string literal at 64 KB.',
    '    const std::string& (*sql)();',
    '};',
    '',
    `inline constexpr int kSchemaVersion = ${Math.max(...migrations.map((m) => m.version))};`,
    '',
    'namespace detail {',
    '',
];

let totalChunks = 0;

migrations.forEach((m, i) => {
    const { lines: fn, chunkCount } = emitScriptFn(`migrationSql${i}`, m.sql, 'MIGSQL');
    totalChunks += chunkCount;
    lines.push(...fn);
});

seeds.forEach((s, i) => {
    const { lines: fn, chunkCount } = emitScriptFn(`seedSql${i}`, s.sql, 'SEEDSQL');
    totalChunks += chunkCount;
    lines.push(...fn);
});

lines.push('}  // namespace detail', '');

lines.push(`inline constexpr std::array<EmbeddedScript, ${migrations.length}> kMigrations{{`);
migrations.forEach((m, i) => {
    lines.push(`    {${m.version}, "${m.name}", "${m.checksum}", &detail::migrationSql${i}},`);
});
lines.push('}};', '');

lines.push(`inline constexpr std::array<EmbeddedScript, ${seeds.length}> kSeeds{{`);
seeds.forEach((s, i) => {
    lines.push(`    {${s.version}, "${s.name}", "${s.checksum}", &detail::seedSql${i}},`);
});
lines.push('}};', '', '}  // namespace pos::db', '');

const content = lines.join('\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (existing === content) {
    console.log('[gen-migrations] up to date');
} else {
    fs.writeFileSync(OUT, content, 'utf8');
    console.log(`[gen-migrations] wrote ${path.relative(ROOT, OUT)}`);
}
console.log(
    `[gen-migrations] ${migrations.length} migration(s), ${seeds.length} seed script(s), ` +
        `${totalChunks} literal chunk(s), schema v${Math.max(...migrations.map((m) => m.version))}`,
);
