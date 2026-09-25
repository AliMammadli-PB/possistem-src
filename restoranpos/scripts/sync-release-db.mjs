#!/usr/bin/env node
/**
 * Upsert published release row + optionally refresh admin-web dist.
 * Uses server .env + psql (no superadmin password needed).
 *
 *   POS_SSH_PASS='…' node scripts/sync-release-db.mjs
 */
import { Client } from 'ssh2';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const FEED = (process.env.UPDATE_FEED_URL ?? 'https://possistem.az/pos-updates').replace(/\/+$/, '');
const version = pkg.version;
const setupName = `Possistem-Setup-${version}.exe`;
const artifactUrl = `${FEED}/${setupName}`;

const localSetup =
  [
    path.join(ROOT, `release-${version}`, setupName),
    path.join(ROOT, 'release', setupName),
  ].find((p) => fs.existsSync(p)) ?? null;

const sha256 = localSetup
  ? createHash('sha256').update(fs.readFileSync(localSetup)).digest('hex')
  : null;

if (!PASS) {
  console.error('POS_SSH_PASS required');
  process.exit(1);
}

function sudoBash(script) {
  const escapedPass = PASS.replace(/'/g, `'\\''`);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `printf '%s\\n' '${escapedPass}' | sudo -S -p '' bash -lc ${JSON.stringify(
    `echo ${b64} | base64 -d | bash -s`,
  )}`;
}

function exec(conn, command, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`timeout\n${stdout || stderr}`));
      }, timeoutMs);
      stream.on('data', (d) => {
        stdout += d.toString();
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`exit ${code}\n${stderr || stdout}`));
        else resolve({ stdout, stderr });
      });
    });
  });
}

const notes = `Milioner POS ${version} Windows setup`;
function sqlStr(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const sql = `
DO $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM releases WHERE channel = 'stable' AND version = ${sqlStr(version)} LIMIT 1;
  IF existing_id IS NULL THEN
    INSERT INTO releases (id, channel, version, notes, artifact_url, checksum_sha256, published, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'stable',
      ${sqlStr(version)},
      ${sqlStr(notes)},
      ${sqlStr(artifactUrl)},
      ${sha256 ? sqlStr(sha256) : 'NULL'},
      true,
      now(),
      now()
    );
  ELSE
    UPDATE releases SET
      notes = ${sqlStr(notes)},
      artifact_url = ${sqlStr(artifactUrl)},
      checksum_sha256 = ${sha256 ? sqlStr(sha256) : 'checksum_sha256'},
      published = true,
      updated_at = now()
    WHERE id = existing_id;
  END IF;
END $$;

-- Retire the previous stable rather than delete it.
--
-- This used to DELETE every other published stable row, which threw away the
-- only record of what the fleet was running five minutes ago: pinning a customer
-- back to it, or reading its checksum, became impossible the moment a new
-- version shipped. Unpublishing keeps exactly one row advertised while leaving
-- every earlier release as a rollback target.
UPDATE releases SET published = false, updated_at = now()
WHERE channel = 'stable'
  AND version <> ${sqlStr(version)}
  AND published = true;

SELECT id, channel, version, published, artifact_url FROM releases ORDER BY created_at DESC;
`;

const script = `
set -euo pipefail
ENV_FILE=/var/lib/possistem-pos-control/.env
if [ ! -f "\$ENV_FILE" ]; then
  ENV_FILE=/opt/possistem-pos-control/.env
fi
DATABASE_URL=\$(grep -E '^DATABASE_URL=' "\$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"\$//' -e "s/^'//" -e "s/'\$//")
if [ -z "\${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL missing in \$ENV_FILE" >&2
  exit 1
fi
psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
${sql}
SQL
`;

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      console.log(`[sync-release] upsert ${version} → ${artifactUrl}`);
      const result = await exec(conn, sudoBash(script));
      process.stdout.write(result.stdout + '\n');
      conn.end();
    } catch (err) {
      console.error('[sync-release] ERROR', err.message);
      conn.end();
      process.exit(1);
    }
  })
  .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
    finish(prompts.map(() => PASS));
  })
  .on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  })
  .connect({
    host: HOST,
    username: USER,
    password: PASS,
    tryKeyboard: true,
    readyTimeout: 60000,
  });
