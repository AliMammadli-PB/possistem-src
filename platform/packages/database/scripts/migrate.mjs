#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'migrations');
const url =
  process.env.DATABASE_URL ??
  'postgresql://milioner:milioner@127.0.0.1:5433/milioner_control';

const sql = postgres(url, { max: 1 });

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await sql`SELECT 1 FROM _migrations WHERE id = ${file}`;
    if (applied.length) {
      console.log(`[migrate] skip ${file}`);
      continue;
    }
    const body = readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[migrate] apply ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (id) VALUES (${file})`;
    });
  }
  console.log('[migrate] done');
  await sql.end();
}

main().catch(async (err) => {
  console.error('[migrate] failed', err);
  await sql.end();
  process.exit(1);
});
