#!/usr/bin/env node
/**
 * Puts the three patched root files back to their checkpoint.
 *
 * Every apply-restaurant-*.mjs rewrites these in place and there is no pristine
 * bundle to rebuild from — the Vite source tree is out of scope here. So the
 * .orig files are the only way back if a patch anchors onto the wrong string.
 *
 * Note what these actually are: a snapshot of the bundle AS IT WAS when the
 * checkpoint was taken, already carrying every earlier patch. Restoring undoes
 * changes made after that point, not the whole patch history.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index-DAmHwBc4.js', 'possistem-system.css', 'index.js'];

let restored = 0;
for (const name of FILES) {
  const live = path.join(ROOT, name);
  const backup = `${live}.orig`;
  if (!fs.existsSync(backup)) {
    console.log(`no checkpoint for ${name} — skipped`);
    continue;
  }
  if (fs.readFileSync(backup).equals(fs.readFileSync(live))) {
    console.log(`${name} already matches its checkpoint`);
    continue;
  }
  fs.copyFileSync(backup, live);
  console.log(`restored ${name}`);
  restored += 1;
}

console.log(
  restored > 0
    ? `\n${restored} file(s) restored. Relaunch with POS_REBUILD_ON_LAUNCH=0 so the patch chain does not immediately re-apply.`
    : '\nnothing to restore',
);
