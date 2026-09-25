#!/usr/bin/env node
/**
 * Restaurant Possistem product chrome — not Offline / Millioner POS.
 * Idempotent patches against the checked-in restaurant renderer bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_BRAND_v1 */';
const LOGO = './assets/brands/logo.png';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

function replaceAllExact(src, find, repl, expected, label) {
  const n = src.split(find).length - 1;
  must(n === expected, `${label}: expected ${expected} matches, got ${n}`);
  return src.split(find).join(repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

must(fs.existsSync(path.join(ROOT, 'assets/brands/logo.png')), 'missing assets/brands/logo.png');

s = s.replace(
  /const brandMark = "data:image\/png;base64,[^"]+";/,
  `const brandMark = ${JSON.stringify(LOGO)};`,
);
must(s.includes(`const brandMark = ${JSON.stringify(LOGO)}`), 'brandMark path');

s = replaceAllExact(s, 'brand: "Milioner Pub & Lounge"', 'brand: "possistem"', 3, 'i18n brand');
s = replaceOnce(s, 'tagline: "Restaurant & Lounge"', 'tagline: "Restaurant POS"', 'en tagline');
s = replaceAllExact(s, 'tagline: "Restoran & Lounge"', 'tagline: "Restoran POS"', 2, 'az/tr tagline');
s = replaceOnce(s, 'eyebrow: "Milioner heyəti"', 'eyebrow: "Heyət girişi"', 'az eyebrow');
s = replaceOnce(s, 'eyebrow: "Milioner staff"', 'eyebrow: "Staff sign-in"', 'en eyebrow');
s = replaceOnce(s, 'eyebrow: "Milioner ekibi"', 'eyebrow: "Personel girişi"', 'tr eyebrow');

s = replaceOnce(
  s,
  'return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "relative flex min-h-full items-center justify-center overflow-hidden bg-ink px-6", children: [',
  'return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-login-tenant relative flex min-h-full items-center justify-center overflow-hidden bg-ink px-6", children: [',
  'tenant login root class',
);

s = replaceOnce(
  s,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mb-7 inline-flex overflow-hidden rounded-2xl border border-gold/30 bg-black shadow-[var(--shadow-lift)]", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              "img",
              {
                src: brandMark,
                alt: "Milioner",
                className: "h-24 w-24 object-cover md:h-28 md:w-28",
                draggable: false
              }
            ) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs tracking-[0.35em] text-gold/80", children: "PUB & LOUNGE" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "mt-3 font-display text-3xl text-gold md:text-4xl", children: t.brand }),`,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-brand-lockup ps-brand-lockup--hero mb-7", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              "img",
              {
                src: brandMark,
                alt: "possistem",
                className: "ps-brand-logo ps-brand-logo--hero",
                draggable: false
              }
            ) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "mt-3 font-display text-3xl text-gold md:text-4xl", children: t.brand }),`,
  'tenant brand panel',
);

s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "", className: "h-11 w-11 rounded-xl object-cover", draggable: false })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo ps-brand-logo--compact", draggable: false })',
  'tenant mobile mark',
);

s = replaceOnce(
  s,
  'className: "relative h-full min-h-[32rem] overflow-hidden bg-ink bg-cover bg-center",\n      style: { backgroundImage: `url(${loginBackground})` },',
  'className: "ps-login-staff relative h-full min-h-[32rem] overflow-hidden bg-ink",',
  'staff login root',
);

s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-gold/35 bg-black shadow-[var(--shadow-lift)]", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "Milioner", className: "h-full w-full object-cover", draggable: false }) }),\n                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [\n                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark text-2xl text-gold-light", children: "Milioner" }),\n                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-dim", children: "Pub & Lounge" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-brand-lockup ps-brand-lockup--tile", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo", draggable: false }) }),\n                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [\n                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark text-2xl text-gold-light", children: t.brand }),\n                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-dim", children: t.tagline })',
  'staff brand panel',
);

s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "overflow-hidden rounded-xl border border-gold/25 bg-black shadow-[var(--shadow-soft)]", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "", className: "h-10 w-10 object-cover", draggable: false }) }),\n          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hidden min-w-0 2xl:block", children: [\n            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark truncate text-[15px] text-gold-light", children: "Milioner" }),\n            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker mt-0.5 truncate text-[8px] text-gold-dim", children: "Pub & Lounge" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-brand-lockup ps-brand-lockup--nav", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo ps-brand-logo--nav", draggable: false }) }),\n          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hidden min-w-0 2xl:block", children: [\n            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark truncate text-[15px] text-gold-light", children: t.brand }),\n            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker mt-0.5 truncate text-[8px] text-gold-dim", children: t.tagline })',
  'sidebar brand',
);

s = replaceOnce(
  s,
  'className: `relative shrink-0 overflow-hidden border border-gold/25 bg-black shadow-[var(--shadow-soft)] ${size}`,\n        "aria-hidden": "true",\n        children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "", className: "h-full w-full object-cover", draggable: false })',
  'className: `ps-staff-initials ${compact ? "ps-staff-initials--sm" : ""}`,\n        "aria-hidden": "true",\n        children: initials(user.fullName) || "A"',
  'admin role initials not logo',
);

s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold-dim", children: "Milioner" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold-dim", children: t.brand })',
  'x-report kicker',
);
s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-[0.4em] text-gold-dim", children: "Milioner" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-[0.4em] text-gold-dim", children: "possistem" })',
  'diagnostics kicker',
);
s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold", children: "Milioner" })',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold", children: t.brand })',
  'tables kicker',
);

must(!s.includes('Milioner Pub & Lounge'), 'Milioner Pub still in bundle chrome');
must(!s.includes('PUB & LOUNGE'), 'PUB & LOUNGE still in bundle');
must(!s.includes('alt: "Milioner"'), 'Milioner alt still in bundle');
must(!/children: "Milioner"/.test(s), 'hardcoded Milioner children remain');
must(!/children: "Pub & Lounge"/.test(s), 'Pub & Lounge children remain');

s = s.replace('/* POS_UX_IA_v1 */', `/* POS_UX_IA_v1 */\n${MARK}`);
must(s.includes(MARK), 'brand mark inserted');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
