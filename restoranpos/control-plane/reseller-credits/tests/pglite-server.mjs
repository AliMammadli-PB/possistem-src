// Throwaway Postgres (PGlite) with the production schema + migration 0032.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import fs from 'node:fs';

const db = await PGlite.create({ extensions: { pgcrypto } });
const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  .split('\n').filter((l) => !/^\\(restrict|unrestrict)/.test(l)).join('\n');
await db.exec(schema);
await db.exec("SELECT pg_catalog.set_config('search_path', 'public', false);");
await db.exec(fs.readFileSync(process.argv[2], 'utf8'));
await db.exec(fs.readFileSync(process.argv[2], 'utf8')); // twice: must be idempotent
const server = new PGLiteSocketServer({ db, port: 55432, host: '127.0.0.1' });
await server.start();
console.log('READY');
