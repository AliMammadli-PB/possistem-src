#!/usr/bin/env node
/**
 * Assembles the Restaurant POS desktop app into out/ - the one build path.
 *
 * The restaurant renderer ships as a packaged bundle (index-DAmHwBc4.js) and
 * main as index.js; their TypeScript sources are not part of this repository.
 * Behaviour changes are idempotent patch scripts (scripts/apply-restaurant-*.mjs)
 * applied in the order below, then the renderer is staged in packaged-renderer/
 * and copied with main into out/, which electron-builder packages.
 *
 * Fail-closed: the first patch that exits non-zero stops the build, so a
 * release can never carry a partially patched bundle. Only an interactive dev
 * launch may pass --allow-partial to keep going with a warning.
 *
 *   node scripts/assemble-restaurant.mjs [--allow-partial]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_PARTIAL = process.argv.includes('--allow-partial');

export const PATCH_ORDER = [
  'apply-restaurant-ux.mjs',
  'apply-restaurant-brand.mjs',
  'apply-restaurant-shell.mjs',
  'apply-restaurant-layout.mjs',
  'apply-restaurant-login.mjs',
  'apply-restaurant-pin.mjs',
  'apply-restaurant-ops.mjs',
  'apply-restaurant-catalog.mjs',
  'apply-restaurant-fix.mjs',
  'apply-restaurant-pin-only.mjs',
  'apply-restaurant-claude-login.mjs',
  'apply-restaurant-table-photos.mjs',
  'apply-restaurant-admin-links.mjs',
  'apply-restaurant-logo.mjs',
  'apply-restaurant-roles.mjs',
  'apply-restaurant-admin-ia.mjs',
  'apply-restaurant-table-bill.mjs',
  'apply-restaurant-no-whatsapp.mjs',
  'apply-restaurant-operations.mjs',
  'apply-restaurant-operations-v3.mjs',
  'apply-restaurant-branch.mjs',
  'apply-restaurant-contract.mjs',
  'apply-restaurant-perm-az.mjs',
  'apply-restaurant-staff-role.mjs',
  'apply-restaurant-ops-doors.mjs',
  'apply-restaurant-role-home.mjs',
  'apply-restaurant-ops-header.mjs',
  'apply-restaurant-stock-ui.mjs',
  'apply-restaurant-ops-tabsync.mjs',
  'apply-restaurant-supply-ui.mjs',
  'apply-restaurant-settings-ui.mjs',
  'apply-restaurant-admin-refresh.mjs',
  'apply-restaurant-settings-design.mjs',
  'apply-restaurant-settings-pro.mjs',
  'apply-restaurant-settings-form.mjs',
  'apply-restaurant-settings-exact.mjs',
  'apply-restaurant-settings-space.mjs',
  'apply-restaurant-settings-legibility.mjs',
  'apply-restaurant-settings-receipt.mjs',
  'apply-restaurant-settings-receipt-brand.mjs',
  'apply-restaurant-touch-receipt.mjs',
  'apply-restaurant-destination-refresh.mjs',
  'apply-restaurant-printer-discovery.mjs',
  'apply-restaurant-refund-code.mjs',
  'apply-restaurant-cash-kinds.mjs',
  'apply-restaurant-printer-roles.mjs',
  'apply-restaurant-printer-roles-v2.mjs',
  'apply-restaurant-warehouse-slip.mjs',
  'apply-restaurant-printer-setup.mjs',
  'apply-restaurant-costing.mjs',
  'apply-restaurant-recipe-editor.mjs',
  'apply-restaurant-recipe-editor-v2.mjs',
  'apply-restaurant-receipt-panel.mjs',
  'apply-restaurant-license-area-tabs.mjs',
  'apply-restaurant-sidebar-access.mjs',
  'apply-restaurant-live-access.mjs',
  'apply-restaurant-lan.mjs',
  'apply-restaurant-locked-visible.mjs',
  'apply-restaurant-locked-pages.mjs',
  'apply-restaurant-license-refresh.mjs',
  'apply-restaurant-license-revoke.mjs',
  'apply-restaurant-license-signature.mjs',
  'apply-restaurant-command-signature.mjs',
  'apply-restaurant-default-pin.mjs',
  'apply-restaurant-i18n-fixes.mjs',
  'apply-restaurant-legacy-names.mjs',
  'apply-restaurant-buildstamp.mjs',
];

const STAGE = path.join(ROOT, 'packaged-renderer');
const OUT = path.join(ROOT, 'out');

function log(msg) {
  process.stdout.write(`[assemble] ${msg}\n`);
}

function applyPatches() {
  const failed = [];
  for (const script of PATCH_ORDER) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, encoding: 'utf8' });
    if (result.status === 0) continue;
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim().split('\n').slice(-3).join(' | ');
    if (!ALLOW_PARTIAL) {
      process.stderr.write(`[assemble] ERROR: ${script} failed (exit ${result.status}): ${detail}\n`);
      process.exit(1);
    }
    failed.push(script);
    process.stderr.write(`[assemble] WARN: ${script} failed - continuing (--allow-partial): ${detail}\n`);
  }
  log(`${PATCH_ORDER.length - failed.length}/${PATCH_ORDER.length} patches applied`);
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), to);
}

function stageRenderer() {
  copy('index.js', path.join(STAGE, 'index.js'));
  copy('index.html', path.join(STAGE, 'index.html'));
  copy('possistem-system.css', path.join(STAGE, 'possistem-system.css'));
  copy('index-DAmHwBc4.js', path.join(STAGE, 'assets', 'index-BsrHjfOR.js'));
  copy('assets/brands/logo.png', path.join(STAGE, 'assets', 'brands', 'logo.png'));
  copy('assets/backgrounds/login-bg.png', path.join(STAGE, 'assets', 'backgrounds', 'login-bg.png'));
  copy('assets/backgrounds/login-bg.png', path.join(STAGE, 'assets', 'login-bg-Dobpt4ta.png'));
}

function buildOut() {
  copy('index.js', path.join(OUT, 'main', 'index.js'));
  const renderer = path.join(OUT, 'renderer');
  fs.rmSync(renderer, { recursive: true, force: true });
  fs.cpSync(STAGE, renderer, { recursive: true, filter: (src) => path.relative(STAGE, src) !== 'index.js' });
  for (const stale of ['index.js', path.join('assets', 'index-Wq1QJL_s.js')]) {
    fs.rmSync(path.join(renderer, stale), { force: true });
  }
  const preload = path.join(OUT, 'preload', 'index.js');
  for (const file of [path.join(OUT, 'main', 'index.js'), preload, path.join(renderer, 'index.html'), path.join(renderer, 'assets', 'index-BsrHjfOR.js')]) {
    if (!fs.existsSync(file)) {
      process.stderr.write(`[assemble] ERROR: missing ${path.relative(ROOT, file)}\n`);
      process.exit(1);
    }
  }
  log('out/ ready (main, preload, renderer)');
}

applyPatches();
stageRenderer();
buildOut();
