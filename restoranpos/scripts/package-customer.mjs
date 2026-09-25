#!/usr/bin/env node
/** Build a distinct, code-signed Windows installer from an admin-exported profile. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const profileArg = args[args.indexOf('--profile') + 1];
if (!profileArg || args.indexOf('--profile') < 0) {
  console.error('Usage: npm run package:customer -- --profile C:\\path\\customer-profile.json');
  process.exit(2);
}
const profilePath = path.resolve(profileArg);
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
if (!profile || typeof profile !== 'object' || typeof profile.productName !== 'string') {
  throw new Error('Profile must contain productName');
}
if (!/^[\p{L}\p{N} .&()_\-]{1,80}$/u.test(profile.productName)) {
  throw new Error('productName contains unsupported installer characters');
}
const slug = profile.productName
  .normalize('NFKD')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 48) || 'Customer';

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const env = { ...process.env, POS_CUSTOMER_PROFILE_PATH: profilePath };
run(npm, ['run', 'typecheck'], env);
run(npm, ['run', 'build:core'], env);
run(npm, ['run', 'build:desktop'], env);

if (!env.CSC_LINK && !env.WIN_CSC_LINK && env.POS_ALLOW_UNSIGNED_PACKAGE !== '1') {
  throw new Error('Customer installers require CSC_LINK/CSC_KEY_PASSWORD for Windows signing');
}

const source = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
const outputDir = `release-customer-${slug}`;
const config = source
  .replace(/^productName:\s*.*$/m, `productName: "${profile.productName.replace(/"/g, '\\"')}"`)
  .replace(/^executableName:\s*.*$/m, `executableName: "${slug} POS"`)
  .replace(/^\s*output:\s*.*$/m, `  output: ${outputDir}`)
  .replace(/^\s*artifactName:\s*.*$/m, `  artifactName: ${slug}-POS-Setup-\${version}.\${ext}`)
  .replace(/^\s*shortcutName:\s*.*$/m, `  shortcutName: "${profile.productName.replace(/"/g, '\\"')} POS"`)
  .replace(/^\s*uninstallDisplayName:\s*.*$/m, `  uninstallDisplayName: "${profile.productName.replace(/"/g, '\\"')} POS"`);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cyberplus-customer-'));
const configPath = path.join(tempDir, 'electron-builder.customer.yml');
fs.writeFileSync(configPath, config, 'utf8');
try {
  run(npx, ['electron-builder', '--win', '--x64', '--config', configPath, '--publish', 'never'], env);
  console.log(`[package-customer] ${profile.productName}: ${path.join(ROOT, outputDir)}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
