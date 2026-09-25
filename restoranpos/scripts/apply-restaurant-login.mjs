#!/usr/bin/env node
/**
 * Restaurant tenant login: two-column Possistem gate whose LEFT panel
 * matches the previous restaurant chrome (same composition as the
 * MarketPos reference) but with possistem / Restoran POS copy only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LOGIN_v6 */';

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

must(s.includes('ps-rest-gate-grid'), 'two-column gate must exist');
must(fs.existsSync(path.join(ROOT, 'assets/backgrounds/login-bg.png')), 'missing assets/backgrounds/login-bg.png');

if (!s.includes('ps-rest-gate-photo')) {
  s = replaceOnce(
    s,
    `  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-grid", children: [`,
    `  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-photo", style: { backgroundImage: \`url(\${loginBackground})\` }, "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-grid", children: [`,
    'tenant photo layer',
  );
  s = replaceOnce(
    s,
    `                    className: "ps-rest-gate-submit",
                    children: busy ? t.common.loading : t.tenant.submit
                  }
                )
              ]
            }
          )
  ] }) });
}`,
    `                    className: "ps-rest-gate-submit",
                    children: busy ? t.common.loading : t.tenant.submit
                  }
                )
              ]
            }
          )
        ] })
  ] });
}`,
    'tenant photo close',
  );
}

if (!s.includes('ps-rest-staff-photo')) {
  s = replaceOnce(
    s,
    `      className: "ps-rest-staff",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-staff-grid", children: [`,
    `      className: "ps-rest-staff",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-staff-photo", style: { backgroundImage: \`url(\${loginBackground})\` }, "aria-hidden": "true" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-staff-grid", children: [`,
    'staff photo layer',
  );
}

if (!s.includes('ps-rest-gate-wordmark')) {
  s = replaceOnce(
    s,
    `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-brand", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-brand-lockup ps-brand-lockup--hero", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
              "img",
              {
                src: brandMark,
                alt: "possistem",
                className: "ps-brand-logo ps-brand-logo--hero",
                draggable: false
              }
            ) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-rest-gate-title", children: t.brand }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-rule" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: t.tenant.gateHint }),
            trialHint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: trialHint }) : null
          ] }),`,
    `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-brand", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-head", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-brand-lockup ps-brand-lockup--hero", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
                "img",
                {
                  src: brandMark,
                  alt: "possistem",
                  className: "ps-brand-logo ps-brand-logo--hero",
                  draggable: false
                }
              ) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-wordmark", children: t.brand }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-sub", children: t.tagline })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-rest-gate-copy", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-kicker", children: t.tagline }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-rest-gate-title", children: t.tenant.title }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-rest-gate-rule" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: t.tenant.gateHint }),
              trialHint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-hint", children: trialHint }) : null
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-rest-gate-secure", children: t.login.secureAccess })
          ] }),`,
    'tenant left brand panel',
  );
}

must(s.includes('ps-rest-gate-photo'), 'tenant photo missing');
must(s.includes('ps-rest-gate-wordmark'), 'wordmark missing');
must(s.includes('ps-rest-gate-secure'), 'secure footer missing');
must(s.includes('t.brand'), 'possistem brand binding missing');
must(!s.includes('ps-login-tenant'), 'MarketPos tenant class leaked');
must(!s.includes('ps-login-staff'), 'MarketPos staff class leaked');
must(!s.includes('MarketPos'), 'MarketPos leaked');
must(!s.includes('Sahibkar'), 'Sahibkar leaked');
must(!s.includes('MARKET & RETAIL'), 'MARKET & RETAIL leaked');
must(!s.includes('Milioner Pub & Lounge'), 'Milioner Pub leaked');

if (s.includes('/* POS_LOGIN_v5 */')) {
  s = s.replace('/* POS_LOGIN_v5 */', `/* POS_LOGIN_v5 */\n${MARK}`);
} else if (s.includes('/* POS_LOGIN_v4 */')) {
  s = s.replace('/* POS_LOGIN_v4 */', `/* POS_LOGIN_v4 */\n${MARK}`);
} else {
  s = s.replace('/* POS_LAYOUT_v3 */', `/* POS_LAYOUT_v3 */\n${MARK}`);
}
must(s.includes(MARK), 'login mark');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
