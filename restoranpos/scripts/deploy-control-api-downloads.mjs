/**
 * Patch-deploy downloads route (feed 502 fix) to the control host.
 *   POS_SSH_PASS='…' node scripts/deploy-control-api-downloads.mjs
 */
import { Client } from 'ssh2';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTROL = path.join(ROOT, 'control');
const PASS = process.env.POS_SSH_PASS ?? '';
const USER = process.env.POS_SSH_USER ?? 'server';
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
if (!PASS) {
  console.error('POS_SSH_PASS required');
  process.exit(1);
}

console.log('[deploy-api] building @cyberplus/api…');
execSync('pnpm --filter @cyberplus/api build', { cwd: CONTROL, stdio: 'inherit' });

const local = path.join(CONTROL, 'apps', 'api', 'dist', 'routes', 'downloads.js');
if (!fs.existsSync(local)) {
  console.error('missing', local);
  process.exit(1);
}

const remoteTmp = `/home/${USER}/downloads.js`;
const remoteFinal = '/opt/cyberplus-pos-control/apps/api/dist/routes/downloads.js';

const c = new Client();
c.on('ready', () => {
  c.sftp((err, sftp) => {
    if (err) throw err;
    console.log('[deploy-api] upload', local);
    sftp.fastPut(local, remoteTmp, (putErr) => {
      if (putErr) throw putErr;
      const cmd = [
        `echo '${PASS.replace(/'/g, `'\\''`)}' | sudo -S cp ${remoteTmp} ${remoteFinal}`,
        `echo '${PASS.replace(/'/g, `'\\''`)}' | sudo -S chown cyberplus-pos:cyberplus-pos ${remoteFinal}`,
        `echo '${PASS.replace(/'/g, `'\\''`)}' | sudo -S systemctl restart cyberplus-pos-control.service`,
        'sleep 1',
        'curl -sS http://127.0.0.1:3210/pos/api/health',
        'echo',
      ].join(' && ');
      c.exec(cmd, (e2, stream) => {
        if (e2) throw e2;
        stream.on('data', (d) => process.stdout.write(d));
        stream.stderr.on('data', (d) => process.stderr.write(d));
        stream.on('close', (code) => {
          c.end();
          process.exit(code ?? 0);
        });
      });
    });
  });
}).connect({ host: HOST, username: USER, password: PASS });
