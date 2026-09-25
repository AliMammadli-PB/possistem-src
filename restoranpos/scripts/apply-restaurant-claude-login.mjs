#!/usr/bin/env node
/**
 * Claude login bits on the restaurant bundle:
 * no "remember me" checkbox; PIN card can leave the tenant session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_CLAUDE_LOGIN_v1 */';
const CSS_MARK = '/* POS_CLAUDE_LOGIN_v1 */';

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
  console.log('bundle already applied');
} else {
  s = replaceOnce(
    s,
    '    rememberMe: "Məni xatırla"\n  },',
    '    rememberMe: "Məni xatırla",\n    switchAccount: "Hesabı dəyiş"\n  },',
    'az switchAccount',
  );
  s = replaceOnce(
    s,
    '    rememberMe: "Remember me"\n  },',
    '    rememberMe: "Remember me",\n    switchAccount: "Switch account"\n  },',
    'en switchAccount',
  );
  s = replaceOnce(
    s,
    '    rememberMe: "Beni hatırla"\n  },',
    '    rememberMe: "Beni hatırla",\n    switchAccount: "Hesabı değiştir"\n  },',
    'tr switchAccount',
  );
  s = replaceOnce(
    s,
    '  const [rememberMe, setRememberMe] = reactExports.useState(true);\n  const [busy, setBusy] = reactExports.useState(false);',
    '  const [busy, setBusy] = reactExports.useState(false);',
    'drop rememberMe state',
  );
  s = replaceOnce(
    s,
    '      localStorage.removeItem(LEGACY_PASSWORD_KEY);\n      if (localStorage.getItem(REMEMBER_KEY) !== "1") return;\n      setRememberMe(true);\n      setEmail(localStorage.getItem(REMEMBER_EMAIL) ?? "");',
    '      localStorage.removeItem(LEGACY_PASSWORD_KEY);\n      localStorage.removeItem(REMEMBER_KEY);\n      setEmail(localStorage.getItem(REMEMBER_EMAIL) ?? "");',
    'always prefills email',
  );
  s = replaceOnce(
    s,
    `    try {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_KEY, "1");
        localStorage.setItem(REMEMBER_EMAIL, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_KEY);
        localStorage.removeItem(REMEMBER_EMAIL);
      }
    } catch {
    }`,
    `    try {
      localStorage.removeItem(REMEMBER_KEY);
      localStorage.setItem(REMEMBER_EMAIL, email.trim());
    } catch {
    }`,
    'persist email only',
  );
  s = replaceOnce(
    s,
    `                /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "ps-rest-gate-remember", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "input",
                    {
                      type: "checkbox",
                      checked: rememberMe,
                      onChange: (e) => setRememberMe(e.target.checked),
                      className: "size-5 rounded border-hairline accent-gold"
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.tenant.rememberMe })
                ] }),
`,
    '',
    'remove remember checkbox',
  );
  s = replaceOnce(
    s,
    '  const [pinPhase, setPinPhase] = reactExports.useState("idle");',
    '  const [pinPhase, setPinPhase] = reactExports.useState("idle");\n  const [tenantBusy, setTenantBusy] = reactExports.useState(false);',
    'tenantBusy state',
  );
  s = replaceOnce(
    s,
    `  const resetSelection = reactExports.useCallback(() => {
    setSelected(null);
    setPin("");
    setError(null);
    setPinPhase("idle");
    submittingRef.current = false;
  }, []);`,
    `  const resetSelection = reactExports.useCallback(() => {
    setSelected(null);
    setPin("");
    setError(null);
    setPinPhase("idle");
    submittingRef.current = false;
  }, []);
  const handleTenantLogout = reactExports.useCallback(async () => {
    if (tenantBusy) return;
    setTenantBusy(true);
    const res = await window.pos.tenant.logout();
    setTenantBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    navigate("/tenant-login", { replace: true });
  }, [navigate, tenantBusy]);`,
    'PIN tenant logout',
  );
  s = replaceOnce(
    s,
    '                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-staff-pin flex min-w-0 flex-1 flex-col justify-center px-0 py-8", children: [\n                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-label brand-kicker text-gold-dim", children: t.login.enterPin }),',
    '                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-staff-pin flex min-w-0 flex-1 flex-col justify-center px-0 py-8", children: [\n                        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", onClick: () => void handleTenantLogout(), disabled: tenantBusy, className: "ps-staff-tenant-out absolute right-5 top-5 flex items-center gap-1.5 rounded-lg border border-gold/20 px-2.5 py-1.5 text-[11px] text-muted hover:border-gold/45 hover:text-cream disabled:opacity-50", children: [\n                          /* @__PURE__ */ jsxRuntimeExports.jsx(LogOut, { className: "h-3.5 w-3.5", strokeWidth: 1.7, "aria-hidden": "true" }),\n                          tenantBusy ? "…" : t.tenant.switchAccount\n                        ] }),\n                        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-label brand-kicker text-gold-dim", children: t.login.enterPin }),',
    'PIN logout button',
  );
  s = MARK + '\n' + s;
  fs.writeFileSync(BUNDLE, s);
  console.log('patched', BUNDLE);
}

let css = fs.readFileSync(CSS, 'utf8');
if (css.includes(CSS_MARK)) {
  console.log('css already applied');
} else {
  css += `
${CSS_MARK}
.ps-staff-pin { position: relative; }
.ps-staff-tenant-out { z-index: 2; }
.ps-rest-gate-remember { display: none !important; }
`;
  fs.writeFileSync(CSS, css);
  console.log('patched', CSS);
}
