#!/usr/bin/env node
/**
 * Parametrlər, rebuilt on the admin design system this product already has.
 *
 * The audit that produced this:
 *
 * KEPT, because it is the good part of the existing identity - the rail and
 * its sticky nav, the scoped `.ps-admin-workspace` token palette (brand
 * #245bd6, lighter than the floor screens' #0a4f9c, which is a deliberate
 * separation between service and administration), flat white cards on
 * #f6f7f9, 12px radius, one hairline border, Manrope, and `psAdminText` for
 * AZ/TR/EN.
 *
 * FIXED:
 *  1. Touch. Inputs rendered at ~36px on a touch till. `--ps-tap` (44px) was
 *     already declared as a token and used nowhere. Every control now meets it.
 *  2. Micro-type. Field labels were 10px uppercase - under the 12px floor and
 *     hard to scan in Azerbaijani, which has more diacritics than the Latin
 *     alphabet this treatment was designed for. Labels are 13px sentence case.
 *  3. Field rhythm. Labels stacked over inputs in a 2-up grid. Wide screens now
 *     get a label column beside a control column, which is what a settings list
 *     is: rows of "this setting" / "this value", scannable down the left edge.
 *  4. Lost context. Long sections (Printer) scrolled their own heading away.
 *     The section header is sticky.
 *  5. The danger zone lost its warning styling entirely when the accordion
 *     wrapper went away in the rail rewrite - a regression from that change.
 *     It is restored through a `data-section` hook.
 *  6. Buttons. Primary, quiet and destructive were three different treatments
 *     depending on which block you were in. One scale now.
 *  7. Focus. `.ps-admin-workspace` defines a 3px focus ring; the settings
 *     inputs were using a Tailwind border colour instead. Same ring everywhere.
 *
 * Done as a stylesheet scoped to the settings panel rather than markup
 * surgery: the existing markup is consistent, so one layer reaches every
 * section at once - including the ones nobody has rewritten - and 52 KB of
 * working printer, display and update logic is never touched.
 *
 * Style direction confirmed against UI-UX-Pro-Max: Minimalism / Swiss
 * (enterprise dashboards, grid-based, high contrast). The same search also
 * returned a landing-page section pattern, a dark #020617 terminal palette and
 * Playfair Display SC - a marketing pairing matched off the word "restaurant".
 * None of those are applied: this is a light administrative surface for dense
 * forms on a till, not a restaurant landing page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'possistem-system.css');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_SETTINGS_DESIGN_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Category-bar form CSS supersedes this layer — never re-patch on launch.
{
  const cssNow = fs.readFileSync(CSS, 'utf8');
  const bundleNow = fs.readFileSync(BUNDLE, 'utf8');
  if (
    cssNow.includes('POS_SETTINGS_FORM_v1') ||
    cssNow.includes('POS_SETTINGS_EXACT_v1') ||
    bundleNow.includes('POS_SETTINGS_FORM_BUNDLE_v1') ||
    bundleNow.includes('POS_SETTINGS_EXACT_BUNDLE_v1') ||
    bundleNow.includes('ps-category-bar') ||
    bundleNow.includes('category-bar')
  ) {
    console.log('css superseded by newer settings chrome — skip');
    process.exit(0);
  }
}

// --- the hook the danger section needs ------------------------------------
let bundle = fs.readFileSync(BUNDLE, 'utf8');
if (!bundle.includes('"data-section": settingsSection')) {
  const anchor = 'className: "ps-settings-stack min-w-0 flex-1 space-y-3", children: [';
  const anchorAfterRefresh = 'className: "ps-settings-stack w-full min-w-0 flex-1 space-y-3", children: [';
  const found = bundle.includes(anchorAfterRefresh) ? anchorAfterRefresh : anchor;
  must(bundle.split(found).length - 1 === 1, 'settings stack anchor not unique');
  bundle = bundle.replace(found, `"data-section": settingsSection, ${found}`);
  fs.writeFileSync(BUNDLE, bundle);
  must(bundle.includes('"data-section": settingsSection'), 'section hook missing');
  console.log('bundle: settings stack now names its open section');
}

// --- the stylesheet -------------------------------------------------------
let css = fs.readFileSync(CSS, 'utf8');

// --- review pass ----------------------------------------------------------
// Two things only showed up once it was rendered with the real stylesheets:
// the commit button sat in the label column and read as one more field, and a
// checkbox row put its control on the left while every other row put it on the
// right. Guarded separately so this converges on its own.
const REFINE = '/* POS_SETTINGS_DESIGN_v2 */';
if (!css.includes(REFINE)) {
  css += `
${REFINE}
/* The action that commits a card belongs at the end of the eye's path, under
   the controls it commits - not in the column of field names. */
/* Matched with the same :is() shape as the base button rule above: that rule's
   \`:is(button, a.touch-target)\` takes the specificity of its most specific arm,
   so a plain \`section > button\` loses to it and the margin never lands. */
.ps-settings-stack section > :is(button, a.touch-target) {
  display: flex; width: fit-content; margin-left: auto; margin-top: 16px;
}
.ps-settings-stack section > div:last-child:has(> button) {
  justify-content: flex-end; margin-top: 16px;
}

/* A switch row reads like every other row: name on the left, control on the
   right. The markup puts the input first, so the axis is reversed rather than
   the DOM - keyboard order still reaches the control before its label text. */
@media (min-width: 1000px) {
  .ps-settings-stack section > label:has(> input[type="checkbox"]) {
    flex-direction: row-reverse; justify-content: space-between;
    padding: 6px 0; font-size: 13px; font-weight: 600; color: #26324a;
  }
}
`;
  fs.writeFileSync(CSS, css);
  must(css.includes('section > :is(button, a.touch-target)'), 'the commit action rule will lose on specificity');
  must(css.includes('row-reverse'), 'the switch row was not aligned');
  console.log('refined: action row and switch row');
}


if (css.includes(MARK)) {
  console.log('css already applied');
  process.exit(0);
}

must(css.includes('.ps-settings-layout{'), 'the admin settings layer is missing');
must(css.includes('--ps-tap'), 'the tap token is missing');

css += `
${MARK}
/* =========================================================================
   Parametrlər - settings panel
   Scoped to .ps-settings-stack so it cannot leak onto the floor screens,
   which keep their own visual language on purpose.
   Spacing scale (density 7): 8 / 12 / 16 / 20 / 24 / 32.
   ========================================================================= */

.ps-settings-layout { --set-gap: 16px; --set-pad: 20px; }

/* --- rail ---------------------------------------------------------------- */
.ps-settings-nav { gap: 4px; padding-right: 4px; }
.ps-settings-nav button {
  font-size: 13px; font-weight: 600; letter-spacing: -0.005em;
  min-height: var(--ps-tap); gap: 10px; padding: 10px 12px;
  transition: background-color 180ms ease, color 180ms ease;
}
.ps-settings-nav button svg { width: 17px; height: 17px; opacity: .75; }
.ps-settings-nav button[aria-current="page"] { font-weight: 700; }
.ps-settings-nav button[aria-current="page"] svg { opacity: 1; }

/* --- section header: stays put while a long section scrolls -------------- */
.ps-settings-stack > div > div:first-child {
  position: sticky; top: 0; z-index: 2;
  margin: 0 0 var(--set-gap) !important;
  padding: 2px 0 12px;
  background: linear-gradient(var(--ps-bg) 72%, transparent);
}
.ps-settings-stack h2 {
  font-size: 19px !important; font-weight: 700; letter-spacing: -.35px;
  color: #182438;
}
.ps-settings-stack > div > div:first-child p { font-size: 13px !important; color: var(--ps-muted); }

/* --- cards --------------------------------------------------------------- */
.ps-settings-stack section {
  padding: var(--set-pad) !important;
  border-radius: 12px; background: var(--ps-surface);
  border: 1px solid var(--ps-line);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
}
.ps-settings-stack section + section { margin-top: var(--set-gap) !important; }
/* The glass treatment belongs to the floor screens; inside settings a card is
   a flat plane, which is what keeps dense forms readable. */
.ps-settings-stack section.glass { backdrop-filter: none; }
.ps-settings-stack section > h2 { font-size: 15px !important; margin-bottom: 2px; }
.ps-settings-stack section > p:first-of-type { margin-bottom: 4px; }

/* --- field rows ---------------------------------------------------------- */
.ps-settings-stack label.block {
  display: grid; gap: 6px; align-items: center;
  padding: 12px 0; border-top: 1px solid #eef1f6;
}
.ps-settings-stack section > label.block:first-of-type,
.ps-settings-stack .grid > label.block { border-top: 0; }
.ps-settings-stack label.block > span:first-child {
  font-size: 13px !important; font-weight: 600; color: #26324a;
  text-transform: none !important; letter-spacing: 0 !important;
}
/* Helper text under a control, not shouting at the same size as the label. */
.ps-settings-stack label.block > span:not(:first-child) {
  font-size: 12px; color: var(--ps-faint); line-height: 1.55;
}

@media (min-width: 1000px) {
  /* A settings list reads as "setting / value" - the left edge becomes a
     scannable column of names instead of a zigzag. */
  .ps-settings-stack section > label.block {
    grid-template-columns: minmax(150px, 230px) minmax(0, 1fr);
    gap: 20px; align-items: center;
  }
  .ps-settings-stack section > label.block > span:not(:first-child) {
    grid-column: 2; margin-top: -2px;
  }
}

/* --- controls: every one of them reaches the tap target ------------------ */
.ps-settings-stack :is(input[type="text"], input[type="url"], input[type="tel"],
                       input[type="number"], input[type="password"], input[type="search"],
                       input:not([type]), select, textarea) {
  min-height: var(--ps-tap);
  width: 100%; box-sizing: border-box;
  padding: 10px 12px !important;
  font-size: 14px; font-family: inherit; color: #182438;
  background: var(--ps-surface);
  border: 1px solid var(--ps-line) !important; border-radius: 10px !important;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.ps-settings-stack textarea { min-height: 88px; padding-top: 12px !important; resize: vertical; }
.ps-settings-stack :is(input, select, textarea):hover:not(:disabled) { border-color: #c9d5e8 !important; }
.ps-settings-stack :is(input, select, textarea):focus-visible {
  border-color: var(--ps-brand) !important;
  box-shadow: 0 0 0 3px #9bbafd; outline: none;
}
.ps-settings-stack :is(input, select, textarea):disabled { background: #f7f9fc; color: #8a95a8; }
.ps-settings-stack input::placeholder { color: #9aa6ba; }
.ps-settings-stack input[type="checkbox"] {
  width: 20px; height: 20px; min-height: 0; accent-color: var(--ps-brand);
  margin: 12px 0;
}
.ps-settings-stack label:has(> input[type="checkbox"]) {
  min-height: var(--ps-tap); display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: #26324a; cursor: pointer;
}

/* --- buttons: one scale, three intents ----------------------------------- */
.ps-settings-stack :is(button, a.touch-target) {
  min-height: var(--ps-tap); border-radius: 10px;
  font-size: 13px; font-weight: 700; font-family: inherit;
  padding: 0 16px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}
.ps-settings-stack button:disabled { opacity: .45; cursor: not-allowed; }
.ps-settings-stack button:focus-visible { outline: 3px solid #9bbafd; outline-offset: 3px; }
/* Primary: the one action that commits this card. */
.ps-settings-stack :is(.btn-gold, button.bg-gold\\/15, button[class*="bg-gold"]) {
  background: var(--ps-brand) !important; color: #fff !important;
  border: 1px solid var(--ps-brand) !important;
}
.ps-settings-stack :is(.btn-gold, button[class*="bg-gold"]):hover:not(:disabled) {
  background: #1d4ec2 !important; border-color: #1d4ec2 !important;
}
/* Quiet: everything that navigates or cancels. */
.ps-settings-stack button[class*="border-hairline"]:not([class*="bg-gold"]) {
  background: var(--ps-surface) !important; color: #3a4761 !important;
  border: 1px solid var(--ps-line) !important;
}
.ps-settings-stack button[class*="border-hairline"]:hover:not(:disabled) { background: #f4f7fc !important; }
.ps-settings-stack button[class*="text-danger"], .ps-settings-stack button[class*="bg-danger"] {
  color: var(--ps-danger) !important; border-color: #f3c9c4 !important; background: var(--ps-surface) !important;
}
.ps-settings-stack button[class*="text-danger"]:hover:not(:disabled) { background: #fdf3f2 !important; }

/* --- the danger section -------------------------------------------------- */
/* Restores the warning framing the accordion used to carry; the rail rewrite
   dropped it, which left a database reset looking like any other card. */
.ps-settings-stack[data-section="danger"] section {
  border-color: #f3c9c4; background: #fffbfb;
}
.ps-settings-stack[data-section="danger"] > div > div:first-child h2 { color: var(--ps-danger); }
.ps-settings-stack[data-section="danger"] section > h2 { color: var(--ps-danger) !important; }

/* --- receipt preview: a proof, not the whole screen ---------------------- */
.ps-settings-stack .ps-receipt-ticket { margin-inline: auto; }
.ps-settings-stack iframe { border-radius: 10px; border: 1px solid var(--ps-line); background: #fff; }

/* --- motion ------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .ps-settings-stack *, .ps-settings-nav button { transition: none !important; }
}

@media (max-width: 999px) {
  .ps-settings-stack > div > div:first-child { position: static; background: none; }
}
`;

fs.writeFileSync(CSS, css);

// Verified after the block is appended, not before it - these ran too early
// once the refinement block was lifted above them.
must(css.includes('min-height: var(--ps-tap)'), 'controls do not meet the tap target');
must(css.includes('[data-section="danger"]'), 'the danger section has no treatment');
must(css.includes('prefers-reduced-motion'), 'reduced motion not respected');
must(!/font-size:\s*1[01]px/.test(css.slice(css.indexOf(MARK))), 'type below the 12px floor');
// The floor screens must keep their own language.
must(!css.slice(css.indexOf(MARK)).includes('.ps-shell'), 'a rule escaped the settings scope');

console.log('patched', CSS);
