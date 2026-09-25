#!/usr/bin/env node
/**
 * Provisions the update host and optionally uploads a release + source snapshot.
 *
 *   POS_SSH_PASS='…' POS_SSH_USER=server node scripts/setup-update-server.mjs
 *   POS_SSH_PASS='…' POS_SSH_USER=server node scripts/setup-update-server.mjs --upload
 *   POS_SSH_PASS='…' POS_SSH_USER=server node scripts/setup-update-server.mjs --upload --source
 *
 * Notes:
 * - Host :80 is shared with Pterodactyl. We inject /pos-updates/ into that vhost
 *   and also serve a backup listener on :9080.
 * - Never commit POS_SSH_PASS.
 */
import { Client } from 'ssh2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
function installerBasename(version) {
  return `Possistem-Setup-${version}.exe`;
}

const RELEASE_DIR =
  process.env.RELEASE_DIR ||
  (fs.existsSync(path.join(ROOT, `release-${pkg.version}`, installerBasename(pkg.version)))
    ? path.join(ROOT, `release-${pkg.version}`)
    : fs.existsSync(path.join(ROOT, `release-${pkg.version}`, `MilionerPOS-Setup-${pkg.version}.exe`))
      ? path.join(ROOT, `release-${pkg.version}`)
      : path.join(ROOT, 'release'));
const HOST = process.env.POS_SSH_HOST ?? '169.58.242.152';
const USER = process.env.POS_SSH_USER ?? 'server';
const PASS = process.env.POS_SSH_PASS ?? '';
const UPLOAD = process.argv.includes('--upload');
const UPLOAD_SOURCE = process.argv.includes('--source');
const UPDATE_DIR = '/var/www/pos-updates';
const SOURCE_DIR = '/var/www/pos-source';

if (!PASS) {
  console.error('POS_SSH_PASS is required');
  process.exit(1);
}

function exec(conn, command, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`timeout after ${timeoutMs}ms\n${stdout || stderr}`));
      }, timeoutMs);

      stream.on('data', (d) => {
        stdout += d.toString();
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`exit ${code}\nCMD: ${command}\n${stderr || stdout}`));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  });
}

function uploadFile(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(localPath, remotePath, (putErr) => {
        if (putErr) reject(putErr);
        else resolve();
      });
    });
  });
}

function sudoBash(script) {
  const escapedPass = PASS.replace(/'/g, `'\\''`);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `printf '%s\\n' '${escapedPass}' | sudo -S -p '' bash -lc ${JSON.stringify(
    `echo ${b64} | base64 -d | bash -s`,
  )}`;
}

const POS_SNIPPET = `# BEGIN maison-aurelia-pos
location ^~ /pos-updates/ {
    alias /var/www/pos-updates/;
    autoindex on;
    add_header Access-Control-Allow-Origin * always;
    add_header Cache-Control "no-cache" always;
    types { }
    default_type application/octet-stream;
}

location ^~ /pos-source/ {
    alias /var/www/pos-source/;
    autoindex on;
}
# END maison-aurelia-pos
`;

const standalone9080 = `server {
    listen 9080;
    listen [::]:9080;
    server_name _;
    root /var/www;

    location /pos-updates/ {
        alias /var/www/pos-updates/;
        autoindex on;
        add_header Access-Control-Allow-Origin * always;
        add_header Cache-Control "no-cache" always;
        types { }
        default_type application/octet-stream;
    }

    location /pos-source/ {
        alias /var/www/pos-source/;
        autoindex on;
    }

    location = /health {
        default_type text/plain;
        return 200 'ok\\n';
    }
}
`;

function injectSnippet(conf) {
  let text = conf;
  const idx = text.indexOf('server');
  if (idx > 0) text = text.slice(idx);

  if (text.includes('BEGIN maison-aurelia-pos')) {
    return text.replace(/# BEGIN maison-aurelia-pos[\s\S]*?# END maison-aurelia-pos\n?/, POS_SNIPPET);
  }
  const m = text.match(/server\s*\{/);
  if (!m) throw new Error('could not find server { in pterodactyl.conf');
  const insertAt = m.index + m[0].length;
  return text.slice(0, insertAt) + '\n\n' + POS_SNIPPET + '\n' + text.slice(insertAt);
}

function packSourceArchive() {
  const out = path.join(os.tmpdir(), `milioner-pos-source-${pkg.version}-${Date.now()}.zip`);
  const exclude = [
    'node_modules/*',
    '**/node_modules/*',
    'native/build/*',
    'native/build-*/*',
    'out/*',
    'release/*',
    'release-*/*',
    '.git/*',
    'dist/*',
    '**/dist/*',
    'coverage/*',
    '*.log',
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
  ];
  if (process.platform === 'win32') {
    // Prefer tar (Windows 10+); fall back to Compress-Archive via PowerShell if needed.
    const tarArgs = ['-a', '-cf', out, '-C', ROOT];
    for (const e of exclude) {
      tarArgs.push(`--exclude=${e}`);
    }
    tarArgs.push('.');
    const r = spawnSync('tar', tarArgs, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('tar source archive failed');
  } else {
    const r = spawnSync(
      'zip',
      ['-r', out, '.', ...exclude.flatMap((e) => ['-x', e])],
      { cwd: ROOT, stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error('zip source archive failed');
  }
  return out;
}

const conn = new Client();

conn
  .on('ready', async () => {
    try {
      console.log(`[setup] connected ${USER}@${HOST}`);

      const who = await exec(conn, 'whoami && id', 30_000);
      process.stdout.write(who.stdout + '\n');

      console.log('[setup] apt update…');
      await exec(
        conn,
        sudoBash('export DEBIAN_FRONTEND=noninteractive; apt-get update -y'),
        300_000,
      );

      console.log('[setup] install nginx…');
      await exec(
        conn,
        sudoBash('export DEBIAN_FRONTEND=noninteractive; apt-get install -y nginx rsync'),
        300_000,
      );

      console.log('[setup] create dirs…');
      await exec(
        conn,
        sudoBash(
          `mkdir -p ${UPDATE_DIR} ${SOURCE_DIR} && chmod -R 755 ${UPDATE_DIR} ${SOURCE_DIR} && chown -R ${USER}:${USER} ${UPDATE_DIR} ${SOURCE_DIR}`,
        ),
        60_000,
      );

      // Inject into Pterodactyl vhost (owns Host IP on :80)
      console.log('[setup] patch pterodactyl nginx vhost…');
      const pteroRaw = await exec(conn, 'cat /etc/nginx/sites-enabled/pterodactyl.conf');
      const patched = injectSnippet(pteroRaw.stdout);
      const tmpPtero = path.join(os.tmpdir(), 'pterodactyl.pos.conf');
      const tmpStand = path.join(os.tmpdir(), 'pos-updates.nginx.conf');
      fs.writeFileSync(tmpPtero, patched, 'utf8');
      fs.writeFileSync(tmpStand, standalone9080, 'utf8');
      await uploadFile(conn, tmpPtero, `/home/${USER}/pterodactyl.pos.conf`);
      await uploadFile(conn, tmpStand, `/home/${USER}/pos-updates.nginx.conf`);

      await exec(
        conn,
        sudoBash(
          [
            `cp -a /etc/nginx/sites-enabled/pterodactyl.conf /etc/nginx/sites-enabled/pterodactyl.conf.bak.pos || true`,
            `cp /home/${USER}/pterodactyl.pos.conf /etc/nginx/sites-enabled/pterodactyl.conf`,
            `cp /home/${USER}/pos-updates.nginx.conf /etc/nginx/sites-available/pos-updates`,
            'ln -sfn /etc/nginx/sites-available/pos-updates /etc/nginx/sites-enabled/pos-updates',
            'ufw allow 9080/tcp || true',
            'nginx -t',
            'systemctl enable nginx',
            'systemctl reload nginx',
          ].join(' && '),
        ),
        90_000,
      );

      const health = await exec(
        conn,
        'curl -sS -H "Host: possistem.az" http://127.0.0.1/pos-updates/latest.yml | head -n 3; echo; curl -sS http://127.0.0.1:9080/health; echo; df -h / | tail -n 1',
        30_000,
      );
      process.stdout.write(health.stdout + '\n');

      if (UPLOAD) {
        const version = pkg.version;
        const releaseDir = RELEASE_DIR;
        const setupName = fs.existsSync(path.join(releaseDir, installerBasename(version)))
          ? installerBasename(version)
          : `MilionerPOS-Setup-${version}.exe`;
        const backup = await exec(
          conn,
          sudoBash(`
set -euo pipefail
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dst=/var/backups/milioner-pos/$stamp
mkdir -p "$dst/pos-updates" "$dst/pos-source"
cp -a /var/www/pos-updates/. "$dst/pos-updates/" 2>/dev/null || true
cp -a /var/www/pos-source/. "$dst/pos-source/" 2>/dev/null || true
echo "BACKUP=$dst"
`),
          120_000,
        );
        process.stdout.write(backup.stdout + '\n');
        console.log(`[setup] release dir: ${releaseDir}`);
        const candidates = [setupName, `${setupName}.blockmap`, 'latest.yml'];
        for (const name of candidates) {
          const local = path.join(releaseDir, name);
          if (!fs.existsSync(local)) {
            throw new Error(`missing release artifact ${local}`);
          }
          const remote = `${UPDATE_DIR}/${name}`;
          const temporary = `${remote}.uploading-${process.pid}`;
          console.log(`[setup] upload ${name} (${(fs.statSync(local).size / 1e6).toFixed(1)} MB)`);
          await uploadFile(conn, local, temporary);
          await exec(conn, `test -s '${temporary}' && mv -f -- '${temporary}' '${remote}'`, 60_000);
        }

        // A per-version copy of the same feed, so a customer can be pinned to
        // this build later. It has to be a copy of the *real* latest.yml rather
        // than something generated: the sha512 in it is what electron-updater
        // verifies the download against, and it is not stored anywhere else.
        // `url`/`path` are rewritten to climb back out to the shared installer,
        // which electron-updater resolves with `new URL(path, feedBase)`.
        await exec(
          conn,
          sudoBash(`
set -euo pipefail
dir=${UPDATE_DIR}/v/${version}
mkdir -p "$dir"
sed -e 's|^\\(\\s*\\)- url: ${setupName}$|\\1- url: ../../${setupName}|' \\
    -e 's|^path: ${setupName}$|path: ../../${setupName}|' \\
    ${UPDATE_DIR}/latest.yml > "$dir/latest.yml"
grep -q '\\.\\./\\.\\./${setupName}' "$dir/latest.yml"
echo "PINNED_FEED=$dir/latest.yml"
`),
          60_000,
        );

        const listed = await exec(conn, sudoBash(`chmod -R a+rX ${UPDATE_DIR}; ls -lah ${UPDATE_DIR}`), 60_000);
        process.stdout.write(listed.stdout + '\n');

        const check = await exec(
          conn,
          'curl -sS -I -H "Host: possistem.az" http://127.0.0.1/pos-updates/latest.yml | head -n 12',
          30_000,
        );
        process.stdout.write(check.stdout + '\n');
      }

      if (UPLOAD_SOURCE) {
        console.log('[setup] packing source archive…');
        const archive = packSourceArchive();
        const remoteNames = [
          `milioner-pos-source-${pkg.version}.zip`,
          'milioner-pos-source-latest.zip',
        ];
        for (const remoteName of remoteNames) {
          const remote = `${SOURCE_DIR}/${remoteName}`;
          const temporary = `${remote}.uploading-${process.pid}`;
          console.log(
            `[setup] upload source (${(fs.statSync(archive).size / 1e6).toFixed(1)} MB) → ${remote}`,
          );
          await uploadFile(conn, archive, temporary);
          await exec(conn, `test -s '${temporary}' && mv -f -- '${temporary}' '${remote}'`, 60_000);
        }
        await exec(conn, sudoBash(`chmod -R a+rX ${SOURCE_DIR}`), 30_000);
        try {
          fs.unlinkSync(archive);
        } catch {
          /* ignore */
        }
        const listing = await exec(conn, `ls -lah ${SOURCE_DIR}`, 30_000);
        process.stdout.write(listing.stdout + '\n');
      }

      console.log('[setup] done');
      console.log(`[setup] feed URL: http://${HOST}/pos-updates/`);
      if (UPLOAD) {
        console.log(`[setup] pinned feed: http://${HOST}/pos-updates/v/${pkg.version}/`);
      }
      console.log(`[setup] source URL: http://${HOST}/pos-source/`);
      console.log(`[setup] backup feed: http://${HOST}:9080/pos-updates/`);
      conn.end();
    } catch (err) {
      console.error('[setup] ERROR', err.message);
      conn.end();
      process.exit(1);
    }
  })
  .on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
    finish(prompts.map(() => PASS));
  })
  .on('error', (err) => {
    console.error('[setup] connection error', err.message);
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
