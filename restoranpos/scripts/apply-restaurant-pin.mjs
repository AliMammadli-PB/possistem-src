#!/usr/bin/env node
/**
 * Compact glass PIN gate: stack identity + pad vertically (no wide 2-col PIN).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_PIN_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

if (s.includes('ps-staff-auth grid h-full min-h-0 grid-cols-[minmax(13rem,.78fr)_minmax(20rem,1.22fr)]')) {
  s = replaceOnce(
    s,
    `                    className: "ps-staff-auth grid h-full min-h-0 grid-cols-[minmax(13rem,.78fr)_minmax(20rem,1.22fr)]",
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "ps-staff-identity flex flex-col justify-between p-6 xl:p-8", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsxs(
                            "button",
                            {
                              type: "button",
                              className: "ps-staff-switch",
                              onClick: resetSelection,
                              children: [
                                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rotate-180 transition group-hover:-translate-x-0.5", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ArrowGlyph, {}) }),
                                t.login.switchUser
                              ]
                            }
                          ),
                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-identity-card mt-8", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-3xl leading-none text-cream", children: selected.fullName }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-role mt-2", children: t.roles[selected.role] ?? selected.role })
                          ] })
                        ] }),
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2 text-[10px] uppercase tracking-[0.13em] text-faint", children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gold-dim", children: [
                            "02 / ",
                            t.login.verification
                          ] }),
                          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t.login.keyboardHint })
                        ] })
                      ] }),
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-staff-pin flex min-w-0 flex-col justify-center px-6 py-5 xl:px-9", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold-dim", children: t.login.enterPin }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "ps-staff-pin-title mt-2 font-display text-[2rem] leading-none text-cream", children: t.login.pinTitle }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-xs leading-5 text-muted", children: t.login.pinHint }),`,
    `                    className: "ps-staff-auth flex h-full min-h-0 flex-col",
                    children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "ps-staff-identity flex flex-col p-0", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsxs(
                            "button",
                            {
                              type: "button",
                              className: "ps-staff-switch",
                              onClick: resetSelection,
                              children: [
                                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rotate-180 transition group-hover:-translate-x-0.5", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ArrowGlyph, {}) }),
                                t.login.switchUser
                              ]
                            }
                          ),
                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-identity-card mt-7", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(RoleEmblem, { user: selected }),
                            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-employee-info min-w-0 flex-1", children: [
                              /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-[1.15rem] leading-none text-cream", children: selected.fullName }),
                              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-role", children: t.roles[selected.role] ?? selected.role })
                            ] }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-staff-employee-status", children: t.settings.statusActive })
                          ] })
                        ] })
                      ] }),
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-staff-pin flex min-w-0 flex-1 flex-col justify-center px-0 py-8", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-label brand-kicker text-gold-dim", children: t.login.enterPin }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "ps-staff-pin-title mt-2 font-display text-[2rem] leading-none text-cream", children: t.login.pinTitle }),
                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-xs leading-5 text-muted", children: t.login.pinHint }),`,
    'pin stack layout',
  );
}

if (s.includes('enterPin: "PIN",') && s.includes('pinTitle: "4 rəqəmli kod",')) {
  s = replaceOnce(
    s,
    `    enterPin: "PIN",
    wrongPin: "Yanlış PIN",
    locked: "Hesab müvəqqəti kilidlənib",
    unlockHint: "Bir az gözləyin və yenidən cəhd edin",
    eyebrow: "Heyət girişi",
    welcome: "Xoş gəlmisiniz",
    shiftHint: "Növbəni təhlükəsiz girişlə başladın",
    secureAccess: "Yerli və təhlükəsiz POS girişi",
    access: "Giriş",
    chooseHint: "Növbənizə başlamaq üçün profilinizi seçin.",
    activeStaff: "aktiv işçi",
    switchUser: "İşçini dəyiş",
    verification: "Təsdiq",
    keyboardHint: "Rəqəm düymələri ilə də daxil edə bilərsiniz",
    pinTitle: "4 rəqəmli kod",
    pinHint: "Şəxsi PIN kodunuzu daxil edin.",`,
    `    enterPin: "TƏHLÜKƏSİZ GİRİŞ",
    wrongPin: "Yanlış PIN",
    locked: "Hesab müvəqqəti kilidlənib",
    unlockHint: "Bir az gözləyin və yenidən cəhd edin",
    eyebrow: "Heyət girişi",
    welcome: "Xoş gəlmisiniz",
    shiftHint: "Növbəni təhlükəsiz girişlə başladın",
    secureAccess: "Yerli və təhlükəsiz POS girişi",
    access: "Giriş",
    chooseHint: "Növbənizə başlamaq üçün profilinizi seçin.",
    activeStaff: "aktiv işçi",
    switchUser: "İşçini dəyiş",
    verification: "Təsdiq",
    keyboardHint: "Rəqəm düymələri ilə də daxil edə bilərsiniz",
    pinTitle: "PIN kodunuzu daxil edin",
    pinHint: "Hesabınıza daxil olmaq üçün 4 rəqəmli şəxsi kodunuzu yazın.",`,
    'az pin copy',
  );
}

if (s.includes('max-w-[21.5rem] grid-cols-3", "aria-label": "PIN klaviaturası"')) {
  s = replaceOnce(
    s,
    'max-w-[21.5rem] grid-cols-3", "aria-label": "PIN klaviaturası"',
    'max-w-[27.5rem] grid-cols-3", "aria-label": "PIN klaviaturası"',
    'pad max width',
  );
}

must(s.includes('ps-staff-auth flex h-full'), 'pin stack missing');
must(s.includes('ps-staff-employee-status'), 'employee status missing');
must(s.includes('RoleEmblem, { user: selected }'), 'identity avatar missing');

if (s.includes('/* POS_LOGIN_v6 */')) {
  s = s.replace('/* POS_LOGIN_v6 */', `/* POS_LOGIN_v6 */\n${MARK}`);
} else {
  s = s.replace('/* POS_LOGIN_v5 */', `/* POS_LOGIN_v5 */\n${MARK}`);
}
must(s.includes(MARK), 'pin mark');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
