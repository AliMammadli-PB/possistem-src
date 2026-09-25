#!/usr/bin/env node
/**
 * Pull project source from Linux server onto this machine.
 *
 *   POS_SSH_PASS='…' node scripts/download-source-linux.mjs
 */
import { Client } from 'ssh2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const REMOTE_DIR = process.env.POS_SRC_DIR ?? '/home/server/restoran-pos';

if (!PASS) {
  console.error('POS_SSH_PASS is required');
  process.exit(1);
}

function log(msg) {
  process.stdout.write(`[download-source] ${msg}\n`);
}

function exec(conn, command, timeoutMs = 300_000) {
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
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  });
}

function sftpGet(conn, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastGet(remotePath, localPath, (e) => (e ? reject(e) : resolve()));
    });
  });
}

async function main() {
  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30_000 });
  });

  const stamp = Date.now();
  const remoteTar = `/tmp/restoran-pos-pull-${stamp}.tgz`;
  log(`packing ${REMOTE_DIR} on server`);
  const pack = await exec(
    conn,
    `set -e; cd ${REMOTE_DIR} && tar -czf ${remoteTar} \
      --exclude=./node_modules \
      --exclude=./control/node_modules \
      --exclude=./control/.data \
      --exclude=./.git \
      --exclude=./release \
      --exclude=./release-* \
      --exclude=./out \
      --exclude=./native/build \
      --exclude=./native/build-* \
      --exclude=./test-results \
      --exclude=./logs \
      --exclude='./.*.tsbuildinfo' \
      --exclude='./*.tsbuildinfo' \
      --exclude=./.cursor \
      . && ls -lh ${remoteTar}`,
    300_000,
  );
  if (pack.code !== 0) {
    console.error(pack.stdout || pack.stderr);
    process.exit(1);
  }
  process.stdout.write(pack.stdout + '\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-pull-'));
  const localTar = path.join(tmp, 'src.tgz');
  log('downloading');
  await sftpGet(conn, remoteTar, localTar);
  await exec(conn, `rm -f ${remoteTar}`);
  conn.end();

  const sizeMb = (fs.statSync(localTar).size / (1024 * 1024)).toFixed(1);
  log(`extracting ${sizeMb} MB → ${ROOT}`);
  execSync(`tar -xzf "${localTar}" -C "${ROOT}"`, { stdio: 'inherit', shell: true });

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  log(`done — local package.json version is now ${pkg.version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
