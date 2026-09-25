#!/usr/bin/env node
/**
 * Raises the settings panel's smallest type back to the product's own floor.
 *
 * The exact-mockup layer brought four declarations in under 12px: the brand
 * tagline and the logo tile at 10px, the category subtitle and the status badge
 * at 11px. A mockup is read at 100% on a desk; this panel is read at arm's
 * length on a counter, often by someone who is not looking for long. 12px is
 * the floor the rest of this product already keeps, and a test asserts it.
 *
 * Applied as an override layer rather than by editing the exact layer in place,
 * because that layer is appended verbatim from the mockup and re-appended on a
 * clean rebuild - a value edited inside it would be silently undone. The
 * generator's own template is corrected too, so both paths agree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'possistem-system.css');
const GENERATOR = path.join(ROOT, 'scripts/apply-restaurant-settings-exact.mjs');
const MARK = '/* POS_SETTINGS_LEGIBILITY_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- the generator, so a clean rebuild starts correct ----------------------
let generator = fs.readFileSync(GENERATOR, 'utf8');
const templateFixes = [
  ['display: grid; place-items: center; font-size: 10px; font-weight: 900;',
   'display: grid; place-items: center; font-size: 12px; font-weight: 900;'],
  ['display: block; font-size: 10px; color: var(--muted); margin-top: 2px; letter-spacing: .7px;',
   'display: block; font-size: 12px; color: var(--muted); margin-top: 2px; letter-spacing: .7px;'],
  ['display: block; font-size: 11px; color: var(--muted); margin-top: 3px; font-weight: 500;',
   'display: block; font-size: 12px; color: var(--muted); margin-top: 3px; font-weight: 500;'],
  ['font-size: 11px; font-weight: 800; padding: 5px 9px; border-radius: 999px;',
   'font-size: 12px; font-weight: 800; padding: 5px 9px; border-radius: 999px;'],
];
let touched = 0;
for (const [from, to] of templateFixes) {
  const hits = generator.split(from).length - 1;
  if (hits === 0) continue;  // already corrected
  must(hits === 1, `generator: expected one match for ${from.slice(0, 40)}…`);
  generator = generator.replace(from, to);
  touched += 1;
}
if (touched > 0) {
  fs.writeFileSync(GENERATOR, generator);
  console.log(`generator: ${touched} declaration(s) raised to the floor`);
} else {
  console.log('generator already at the floor');
}

const afterFix = fs.readFileSync(GENERATOR, 'utf8');
must(!/font-size:\s*(?:[0-9]|10|11)px/.test(afterFix), 'the generator still emits type under 12px');

// --- the CSS already on disk ----------------------------------------------
let css = fs.readFileSync(CSS, 'utf8');
if (css.includes(MARK)) {
  console.log('css: type floor already applied');
} else {
  must(css.includes('/* POS_SETTINGS_EXACT_v1 */'), 'the exact layer is not present to correct');

  css += `
${MARK}
/* =========================================================================
   Sistem ayarları — oxunaqlılıq döşəməsi
   Maket 10-11px verirdi; bu panel piştaxtada qol məsafəsindən oxunur.
   ========================================================================= */
.ps-settings-page .brandmark { font-size: 12px; }
.ps-settings-page .brandcopy span { font-size: 12px; }
.ps-settings-page .category > span:last-child { font-size: 12px; }
.ps-settings-page .badge { font-size: 12px; }
`;

  fs.writeFileSync(CSS, css);
  console.log('css: settings type floor restored');
}

// --- colours that never made the move to a light page ---------------------
//
// The panel's utility classes were re-pointed when Parametrlər went light:
// --color-elevated became white, --color-cream became ink. `text-faint` was
// missed - it is a hardcoded #eaf1f8b8, a pale tint meant for a dark shell.
// On white that is about 1.05:1, which is not low contrast but no contrast:
// the device path under every printer, and the hint under every field, are
// simply not there. The screenshot that prompted this shows exactly that.
const FAINT_MARK = '/* POS_SETTINGS_LEGIBILITY_v2 */';
let sheet = fs.readFileSync(CSS, 'utf8');
if (sheet.includes(FAINT_MARK)) {
  console.log('css: faint text already corrected');
} else {
  sheet += `
${FAINT_MARK}
/* =========================================================================
   Sistem ayarları — açıq fonda oxunan ton
   ========================================================================= */
.ps-settings-page .text-faint,
.ps-settings-page [class*="text-faint/"] {
  color: #64748b !important;
}

/* Tapılan cihaz sətirləri: ağ kartın üstündə ağ sətir görünmür. */
.ps-settings-page .ps-settings-stack section .space-y-2 > div[class*="border-hairline"] {
  background: #f8fafc !important;
  border-color: #dbe3ec !important;
}
.ps-settings-page .ps-settings-stack section .space-y-2 > div[class*="border-gold"] {
  background: #eef4fc !important;
}
`;
  fs.writeFileSync(CSS, sheet);
  console.log('css: faint text and device rows made visible');
}

const final = fs.readFileSync(CSS, 'utf8');
const layer = final.slice(final.indexOf('/* POS_SETTINGS_EXACT_v1 */'));
must(layer.split('{').length === layer.split('}').length, 'braces unbalanced after the override');
must(final.includes('POS_SETTINGS_LEGIBILITY_v2'), 'the contrast correction did not land');
