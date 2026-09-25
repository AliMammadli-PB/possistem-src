#!/usr/bin/env node
/**
 * Prune legacy MilionerPOS-Setup-* artifacts on the update host,
 * keeping only the current package.json version (+ latest.yml).
 *
 *   POS_SSH_PASS='…' node scripts/prune-old-updates.mjs
 */
import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const UPDATE_DIR = '/var/www/pos-updates';
const KEEP = `MilionerPOS-Setup-${pkg.version}.exe`;

if (!PASS) {
  console.error('POS_SSH_PASS is required');
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

const script = `
set -euo pipefail
cd ${UPDATE_DIR}
shopt -s nullglob
for f in MilionerPOS-Setup-*.exe MilionerPOS-Setup-*.exe.blockmap; do
  case "$f" in
    ${KEEP}|${KEEP}.blockmap) echo "keep $f" ;;
    *) echo "removing $f"; rm -f -- "$f" ;;
  esac
done
chmod -R a+rX ${UPDATE_DIR}
ls -lah ${UPDATE_DIR}
`;

const conn = new Client();
conn
  .on('ready', async () => {
    try {
      console.log(`[prune] keep ${KEEP}`);
      const result = await exec(conn, sudoBash(script));
      process.stdout.write(result.stdout + '\n');
      conn.end();
    } catch (err) {
      console.error('[prune] ERROR', err.message);
      conn.end();
      process.exit(1);
    }
  })
  .on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
    finish(prompts.map(() => PASS));
  })
  .on('error', (err) => {
    console.error('[prune] connection error', err.message);
    process.exit(1);
  })
  .connect({
    host: HOST,
    port: 22,
    username: USER,
    password: PASS,
    readyTimeout: 60000,
    tryKeyboard: true,
  });
