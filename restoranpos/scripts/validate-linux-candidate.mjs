#!/usr/bin/env node
import { Client } from 'ssh2';

const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const CANDIDATE = process.env.POS_CANDIDATE_DIR ?? '';

if (!PASS) throw new Error('POS_SSH_PASS is required');
if (!/^\/home\/server\/restoran-pos\.next-1\.2\.4-[0-9TZ]+$/.test(CANDIDATE)) {
  throw new Error(`refusing invalid POS_CANDIDATE_DIR: ${CANDIDATE}`);
}

function exec(conn, command, timeoutMs = 1_800_000) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (error, stream) => {
      if (error) return reject(error);
      let output = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`remote validation timeout\n${output.slice(-4000)}`));
      }, timeoutMs);
      stream.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
      stream.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(output);
        else reject(new Error(`remote validation exited ${code}\n${output.slice(-4000)}`));
      });
    });
  });
}

const conn = new Client();
await new Promise((resolve, reject) => {
  conn
    .on('ready', resolve)
    .on('error', reject)
    .connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      tryKeyboard: true,
      readyTimeout: 60_000,
    });
});

try {
  await exec(
    conn,
    `
set -euo pipefail
test ! -L '${CANDIDATE}'
test -f '${CANDIDATE}/package.json'
VALIDATOR_NODE_HOME="$HOME/.cache/milioner-pos-validator-node-22.17.0"
if [ ! -x "$VALIDATOR_NODE_HOME/node_modules/node/bin/node" ]; then
  npm install --prefix "$VALIDATOR_NODE_HOME" --no-save --no-audit --no-fund node@22.17.0
fi
export PATH="$VALIDATOR_NODE_HOME/node_modules/node/bin:$PATH"
node --version
cd '${CANDIDATE}'
npm ci --ignore-scripts
npm run typecheck
npm run test:unit
npm run test:visuals
cmake -S native -B native/build-linux -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/build-linux
TZ=Europe/Istanbul ctest --test-dir native/build-linux --output-on-failure
npm run test:fresh-db
npm run test:customer-bill
npm run test:catalog-ordering
npm run build:desktop
node -e "const {execFileSync}=require('child_process');const o=JSON.parse(execFileSync(process.execPath,['scripts/source-tree-manifest.mjs'],{encoding:'utf8',maxBuffer:64*1024*1024}));console.log('SOURCE_MANIFEST='+o.files+':'+o.treeSha256)"
cd control
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @cyberplus/admin-web test
corepack pnpm --filter @cyberplus/admin-web build
echo LINUX_CANDIDATE_OK
`,
  );
} finally {
  conn.end();
}
