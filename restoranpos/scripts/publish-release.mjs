#!/usr/bin/env node
/**
 * Publishes a built installer to its update feed on possistem.az, over the
 * `pos` SSH alias (key auth only; no password is ever used or stored).
 *
 *   node scripts/publish-release.mjs restaurant|market|geyim|aptek|topdan
 *
 * Uploads the Setup .exe and .blockmap (resumable, retried), then latest.yml as
 * latest.yml.new. The swap only happens on the server once the sha512 in the
 * new latest.yml matches the uploaded .exe. The old feed is kept as
 * latest.yml.bak-before-<version>, and a copy goes to v/<version>/latest.yml.
 * Installed tills update from latest.yml, so this is a rollout to every customer.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const APPS = {
  restaurant: () => ({ release: path.join(ROOT, `release-${pkg(ROOT)}`), feed: '/var/www/pos-updates' }),
  market: () => ({ release: path.join(ROOT, '..', 'marketpos', 'release'), feed: '/var/www/marketpos/updates' }),
  geyim: () => ({ release: path.join(ROOT, '..', 'geyimpos', 'release'), feed: '/var/www/geyimpos/updates' }),
  aptek: () => ({ release: path.join(ROOT, '..', 'aptekpos', 'release'), feed: '/var/www/aptekpos/updates' }),
  topdan: () => ({ release: path.join(ROOT, '..', 'topdanpos', 'release'), feed: '/var/www/topdanpos/updates' }),
};
const app = process.argv[2];
if (!APPS[app]) throw new Error(`usage: publish-release.mjs ${Object.keys(APPS).join('|')}`);
const { release, feed } = APPS[app]();

const versionCheck=spawnSync(process.execPath,[path.join(ROOT,'scripts/check-versions.mjs')],{stdio:'inherit'});
if(versionCheck.status!==0)throw Error('Source/runtime versions disagree; publication refused.');
const receipt=JSON.parse(fs.readFileSync(path.join(release,'build-security.json'),'utf8'));
if(receipt.app!==app||receipt.electronVersion!==JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).devDependencies.electron)throw Error('Built Electron runtime does not match the intended release; publication refused.');

const yml = fs.readFileSync(path.join(release, 'latest.yml'), 'utf8');
const version = /^version:\s*(\S+)/m.exec(yml)?.[1];
const exe = /^path:\s*(\S+)/m.exec(yml)?.[1];
if (!version || !exe) throw new Error('latest.yml: version/path missing');
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) || !/^[\w.-]+\.exe$/.test(exe)) throw new Error('latest.yml: unexpected version or file name');
for (const file of [exe, `${exe}.blockmap`]) {
  if (!fs.existsSync(path.join(release, file))) throw new Error(`missing ${file} in ${release}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  return r.status === 0;
}

// Keep this private key off the website server and outside the repository.
const keyFile=process.env.POSSISTEM_UPDATE_SIGNING_KEY||path.join(os.homedir(),'.local/share/possistem/windows-update-signing.pem');
if(!fs.existsSync(keyFile))throw Error('Protected Windows update signing key missing; publication refused.');
const payload={app,version,file:exe,sha512:crypto.createHash('sha512').update(fs.readFileSync(path.join(release,exe))).digest('base64'),size:fs.statSync(path.join(release,exe)).size};
if(receipt.version!==version||receipt.sha512!==payload.sha512)throw Error('Build receipt does not match the installer; publication refused.');
const signature=crypto.sign(null,Buffer.from(JSON.stringify(payload)),fs.readFileSync(keyFile)).toString('base64');
const signed=path.join(release,'signed.json');fs.writeFileSync(signed,JSON.stringify({payload,signature})+'\n');


// Large uploads to the VPS can drop mid-transfer; --partial resumes.
let uploaded = false;
for (let attempt = 1; attempt <= 5 && !uploaded; attempt += 1) {
  uploaded = run('rsync', ['--partial', '-q', path.join(release, exe), path.join(release, `${exe}.blockmap`), `pos:${feed}/`]);
  if (!uploaded) console.error(`[publish] upload attempt ${attempt} failed, retrying`);
}
if (!uploaded) throw new Error('upload failed');
if(!run('ssh',['pos',`mkdir -p ${feed}/v/${version} && chmod 755 ${feed}/v ${feed}/v/${version}`])||!run('scp',['-q',signed,`pos:${feed}/v/${version}/signed.json`]))throw Error('Signed manifest publication failed; feed unchanged.');
// Check the same public URL the installed app uses BEFORE switching the feed.
const publicFeed={restaurant:'pos-updates',market:'marketpos/updates',geyim:'geyimpos/updates',aptek:'aptekpos/updates',topdan:'topdanpos/updates'}[app];
const probe=await fetch(`https://possistem.az/${publicFeed}/v/${version}/signed.json`,{headers:{'user-agent':'Mozilla/5.0 Possistem-Signed-Updater/'+app,'cache-control':'no-cache'},signal:AbortSignal.timeout(15000),redirect:'error'});
if(!probe.ok)throw Error(`Public signed manifest is unavailable (${probe.status}); feed unchanged.`);
const exposed=await probe.json();
if(JSON.stringify(exposed)!==JSON.stringify({payload,signature}))throw Error('Public signed manifest mismatch; feed unchanged.');
if (!run('scp', ['-q', path.join(release, 'latest.yml'), `pos:${feed}/latest.yml.new`])) throw new Error('latest.yml upload failed');

const remote = [
  `cd ${feed}`,
  `want=$(grep -m1 '^sha512:' latest.yml.new | awk '{print $2}')`,
  `got=$(openssl dgst -sha512 -binary ${exe} | base64 -w0)`,
  `[ "$want" = "$got" ] || { echo 'sha512 mismatch, feed unchanged'; rm -f latest.yml.new; exit 1; }`,
  `[ -f latest.yml ] && cp -a latest.yml latest.yml.bak-before-${version} || true`,
  'mv latest.yml.new latest.yml',
  `mkdir -p v/${version} && cp latest.yml v/${version}/latest.yml`,
  // New files take the feed folder's owner (root for pos-updates, www-data for the others).
  `chown -R --reference=. ${exe} ${exe}.blockmap latest.yml v/${version}`,
  `echo "[publish] ${app} ${version} live"`,
].join(' && ');
if (!run('ssh', ['-o', 'BatchMode=yes', 'pos', remote])) throw new Error('feed switch failed');
