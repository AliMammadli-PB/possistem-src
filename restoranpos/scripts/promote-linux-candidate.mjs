#!/usr/bin/env node
import { Client } from 'ssh2';

const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const CANDIDATE = process.env.POS_CANDIDATE_DIR ?? '';
const PREVIOUS = process.env.POS_PREVIOUS_DIR ?? '';
const EXPECTED_SHA256 = process.env.POS_SOURCE_SHA256 ?? '';

if (!PASS) throw new Error('POS_SSH_PASS is required');
if (!/^\/home\/server\/restoran-pos\.next-1\.2\.4-[0-9TZ]+$/.test(CANDIDATE)) {
  throw new Error(`invalid candidate: ${CANDIDATE}`);
}
if (!/^\/home\/server\/restoran-pos\.previous-1\.2\.(?:3|4)-[0-9TZ]+$/.test(PREVIOUS)) {
  throw new Error(`invalid previous path: ${PREVIOUS}`);
}
if (!/^[a-f0-9]{64}$/.test(EXPECTED_SHA256)) throw new Error('invalid POS_SOURCE_SHA256');

function exec(conn, command, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (error, stream) => {
      if (error) return reject(error);
      let output = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`promotion timeout\n${output}`));
      }, timeoutMs);
      stream.on('data', (chunk) => {
        output += chunk.toString();
        process.stdout.write(chunk.toString());
      });
      stream.stderr.on('data', (chunk) => {
        output += chunk.toString();
        process.stderr.write(chunk.toString());
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(output);
        else reject(new Error(`promotion exited ${code}\n${output}`));
      });
    });
  });
}

const conn = new Client();
await new Promise((resolve, reject) => {
  conn
    .on('ready', resolve)
    .on('error', reject)
    .connect({ host: HOST, port: 22, username: USER, password: PASS, tryKeyboard: true, readyTimeout: 60_000 });
});

try {
  await exec(
    conn,
    `
set -euo pipefail
current=/home/server/restoran-pos
candidate='${CANDIDATE}'
previous='${PREVIOUS}'
test -d "$current" && test ! -L "$current"
test -d "$candidate" && test ! -L "$candidate"
test ! -e "$previous"
test "$(realpath "$current")" = /home/server/restoran-pos
test "$(realpath "$candidate")" = '${CANDIDATE}'
test "$(cd "$candidate" && node -p "require('./package.json').version")" = 1.2.4
actual=$(cd "$candidate" && node -e "const {execFileSync}=require('child_process');const o=JSON.parse(execFileSync(process.execPath,['scripts/source-tree-manifest.mjs'],{encoding:'utf8',maxBuffer:64*1024*1024}));process.stdout.write(o.treeSha256)")
test "$actual" = '${EXPECTED_SHA256}'
env_keep=$(mktemp -d /home/server/.milioner-env-XXXXXX)
case "$env_keep" in /home/server/.milioner-env-??????) ;; *) exit 92 ;; esac
(
  cd "$current"
  while IFS= read -r -d '' env_file; do
    target_dir="$env_keep/$(dirname "$env_file")"
    mkdir -p "$target_dir"
    cp -a -- "$env_file" "$target_dir/"
  done < <(find . -maxdepth 3 -type f -name '.env*' -print0)
)
cp -a "$env_keep/." "$candidate/" 2>/dev/null || true
mv -- "$current" "$previous"
if ! mv -- "$candidate" "$current"; then
  mv -- "$previous" "$current"
  exit 93
fi
rm -rf -- "$env_keep"
test "$(cd "$current" && node -p "require('./package.json').version")" = 1.2.4
echo "PROMOTED=/home/server/restoran-pos"
echo "PREVIOUS=$previous"
echo "SOURCE_SHA256=$actual"
`,
  );
} finally {
  conn.end();
}
