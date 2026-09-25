#!/usr/bin/env node
/**
 * Build admin-web and upload only its dist/ to the control host.
 *
 *   POS_SSH_PASS='…' node scripts/deploy-admin-web.mjs
 */
import { Client } from 'ssh2';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTROL = path.join(ROOT, 'control');
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const REMOTE_DIST = '/opt/cyberplus-pos-control/apps/admin-web/dist';

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

function exec(conn, command, timeoutMs = 120_000) {
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

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()));
    });
  });
}

console.log('[deploy-admin] building admin-web…');
execSync('npx -y pnpm@9.15.0 --filter @cyberplus/admin-web build', {
  cwd: CONTROL,
  stdio: 'inherit',
});

const dist = path.join(CONTROL, 'apps', 'admin-web', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('admin-web dist missing');
  process.exit(1);
}

const tarPath = path.join(os.tmpdir(), `admin-web-dist-${Date.now()}.tgz`);
execSync(`tar -czf "${tarPath}" -C "${dist}" .`, { stdio: 'inherit', shell: true });

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      const remoteTar = `/home/${USER}/admin-web-dist.tgz`;
      console.log('[deploy-admin] uploading…');
      await uploadFile(conn, tarPath, remoteTar);
      const result = await exec(
        conn,
        sudoBash(`
set -euo pipefail
target=${REMOTE_DIST}
parent=$(dirname "$target")
stamp=$(date -u +%Y%m%dT%H%M%SZ)
next="$target.next-$stamp"
previous="$target.previous-$stamp"
backup_dir=/var/backups/cyberplus-pos-control/admin-web

test "$target" = /opt/cyberplus-pos-control/apps/admin-web/dist
test -d "$parent"
test ! -e "$next"
test ! -e "$previous"

if [ -e "$target" ]; then
  test -d "$target"
  test ! -L "$target"
  test "$(readlink -f "$target")" = "$target"
  mkdir -p "$backup_dir"
  backup="$backup_dir/admin-web-before-milioner-$stamp.tgz"
  tar -czf "$backup" -C "$parent" "$(basename "$target")"
  test -s "$backup"
  tar -tzf "$backup" >/dev/null
  echo "BACKUP=$backup"
fi

mkdir "$next"
tar -xzf ${remoteTar} -C "$next"
test -s "$next/index.html"
chown -R cyberplus-pos:cyberplus-pos "$next"
find "$next" -type d -exec chmod 755 {} +
find "$next" -type f -exec chmod 644 {} +

if [ -e "$target" ]; then
  mv "$target" "$previous"
fi
mv "$next" "$target"
rm -f ${remoteTar}
echo "PREVIOUS=$previous"
ls -lah "$target" | head
`),
      );
      process.stdout.write(result.stdout + '\n');
      try {
        fs.unlinkSync(tarPath);
      } catch {
        /* ignore */
      }
      console.log('[deploy-admin] done');
      conn.end();
    } catch (err) {
      console.error('[deploy-admin] ERROR', err.message);
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
