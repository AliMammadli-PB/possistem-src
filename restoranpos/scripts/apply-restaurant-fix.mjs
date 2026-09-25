#!/usr/bin/env node
/**
 * POS_FIX_v5: staff LEFT hero gets the blue Possistem logo tile
 * (lounge photo stays — do not paint the panel solid blue).
 * PIN / Admin identity on the RIGHT is never the brand mark —
 * elegant text + initials only. RoleEmblem must not reference brandMark.
 *
 * Çek önbaxış stays POS_FIX_v3: strip imgs, mock fallback, in-DOM ticket.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_FIX_v7 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}
function replaceIfPresent(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n === 0) return src;
  must(n === 1, `${label}: expected 0 or 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
const laterReceiptChrome =
  s.includes('PsReceiptDialog') || s.includes('POS_SETTINGS_RECEIPT_MODAL_v1');
if (
  s.includes(MARK)
  && /ps-rest-staff-brand[\s\S]{0,700}ps-brand-lockup--tile/.test(s)
  && s.includes('ps-staff-pick')
  && s.includes('ps-staff-pin')
  && s.includes('ps-staff-identity-card')
  && s.includes('ps-staff-pin-count')
  && s.includes('ps-staff-initials')
  && s.includes('pinPhase')
  && s.includes('setPinPhase("ok")')
  && s.includes('submittingRef')
  && s.includes('includes("login")')
  && s.includes('await new Promise((done) => window.setTimeout(done, 420));\n    setSession({ ...session, authenticated: true })')
  && !/function RoleEmblem[\s\S]{0,900}brandMark/.test(s)
  && !/ps-staff-identity-card[\s\S]{0,400}ps-brand-lockup/.test(s)
  && (laterReceiptChrome
    || (s.includes('function stripReceiptImages')
      && s.includes('img,canvas{display:none!important}')))
) {
  console.log(laterReceiptChrome ? 'already applied (later receipt chrome)' : 'already applied');
  process.exit(0);
}

const staffBrandPlain = `                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark text-2xl text-gold-light", children: t.brand }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-dim", children: t.tagline })
                  ] })
                ] }),`;

const staffBrandTileWordmark = `                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-brand-lockup ps-brand-lockup--tile", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "possistem", className: "ps-brand-logo", draggable: false }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-wordmark text-2xl text-gold-light", children: t.brand }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-dim", children: t.tagline })
                  ] })
                ] }),`;

const staffBrandHero = `                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-brand-mark flex items-center gap-4", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-brand-lockup ps-brand-lockup--tile", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: brandMark, alt: "", className: "ps-brand-logo", draggable: false }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-brand-kicker", children: t.tagline })
                ] }),`;

if (s.includes(staffBrandPlain)) {
  s = replaceOnce(s, staffBrandPlain, staffBrandHero, 'staff brand blue tile');
} else if (s.includes(staffBrandTileWordmark)) {
  s = replaceOnce(s, staffBrandTileWordmark, staffBrandHero, 'staff brand tile caption');
} else {
  must(/ps-rest-staff-brand[\s\S]{0,700}ps-brand-lockup--tile/.test(s), 'staff brand tile missing');
}

{
  const roleStart = s.indexOf('function RoleEmblem({ user, compact = false })');
  const roleEnd = s.indexOf('function ArrowGlyph()', roleStart);
  must(roleStart >= 0 && roleEnd > roleStart, 'RoleEmblem block missing');
  s = s.slice(0, roleStart) + `function RoleEmblem({ user, compact = false }) {
  const text = initials(user.fullName) || (user.role === "administrator" || user.id === "usr-admin" ? "A" : "M");
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "span",
    {
      className: compact ? "ps-staff-initials ps-staff-initials--sm" : "ps-staff-initials",
      "aria-hidden": "true",
      children: text
    }
  );
}
` + s.slice(roleEnd);
}

s = replaceIfPresent(
  s,
  `                          className: "group relative flex min-h-[7rem] items-center gap-3 overflow-hidden rounded-[1.05rem] border border-gold/13 bg-ink/30 p-3.5 text-left hover:-translate-y-0.5 hover:border-gold/45 hover:bg-oxblood/18 disabled:opacity-35",`,
  `                          className: "ps-staff-pick group relative flex min-h-[7.5rem] items-center gap-3 overflow-hidden rounded-[1.1rem] border p-4 text-left disabled:opacity-35",`,
  'staff pick card',
);
s = replaceIfPresent(
  s,
  `                              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mt-1.5 block truncate text-[10px] uppercase tracking-[0.13em] text-faint", children: t.roles[user.role] ?? user.role }),`,
  `                              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-staff-role mt-1.5 block truncate", children: t.roles[user.role] ?? user.role }),`,
  'staff pick role',
);
s = replaceIfPresent(
  s,
  `                    className: "grid h-full min-h-0 grid-cols-[minmax(12rem,.82fr)_minmax(19rem,1.18fr)]",`,
  `                    className: "ps-staff-auth grid h-full min-h-0 grid-cols-[minmax(13rem,.78fr)_minmax(20rem,1.22fr)]",`,
  'staff auth grid',
);
s = replaceIfPresent(
  s,
  `                      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "flex flex-col justify-between border-r border-gold/12 bg-ink/28 p-6 xl:p-8", children: [`,
  `                      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "ps-staff-identity flex flex-col justify-between p-6 xl:p-8", children: [`,
  'staff identity aside',
);
s = replaceIfPresent(
  s,
  `                              className: "group -ml-2 flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted hover:text-gold-light",`,
  `                              className: "ps-staff-switch",`,
  'staff switch',
);
s = replaceIfPresent(
  s,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-8", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(RoleEmblem, { user: selected }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "mt-4 font-display text-3xl leading-none text-cream", children: selected.fullName }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-[10px] uppercase tracking-[0.17em] text-gold-dim", children: t.roles[selected.role] ?? selected.role })
                          ] })`,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-identity-card mt-8", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-3xl leading-none text-cream", children: selected.fullName }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-role mt-2", children: t.roles[selected.role] ?? selected.role })
                          ] })`,
  'staff identity card text-only',
);
s = replaceIfPresent(
  s,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-identity-card mt-8", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(RoleEmblem, { user: selected }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-3xl leading-none text-cream", children: selected.fullName }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-role mt-2", children: t.roles[selected.role] ?? selected.role })
                          ] })`,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-identity-card mt-8", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-3xl leading-none text-cream", children: selected.fullName }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-role mt-2", children: t.roles[selected.role] ?? selected.role })
                          ] })`,
  'PIN identity never RoleEmblem',
);
s = replaceIfPresent(
  s,
  `  const [busy, setBusy] = reactExports.useState(false);
  const [error, setError] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.auth.listUsers().then((res) => {`,
  `  const [busy, setBusy] = reactExports.useState(false);
  const [pinPhase, setPinPhase] = reactExports.useState("idle");
  const submittingRef = reactExports.useRef(false);
  const [error, setError] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.auth.listUsers().then((res) => {`,
  'staff pin phase state',
);
s = replaceIfPresent(
  s,
  `  const [pinPhase, setPinPhase] = reactExports.useState("idle");
  const [error, setError] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.auth.listUsers().then((res) => {`,
  `  const [pinPhase, setPinPhase] = reactExports.useState("idle");
  const submittingRef = reactExports.useRef(false);
  const [error, setError] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.auth.listUsers().then((res) => {`,
  'staff pin submitting ref',
);
s = replaceIfPresent(
  s,
  `  const submit = reactExports.useCallback(async () => {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    const res = await window.pos.auth.login(selected.id, pin);
    setBusy(false);
    if (!res.success) {
      setPin("");
      if (res.error.code === "E_PIN_LOCKED") setError(t.login.locked);
      else if (res.error.code === "E_INVALID_PIN") setError(t.login.wrongPin);
      else setError(res.error.message);
      return;
    }
    const session = res.data.session;
    setSession({ ...session, authenticated: true });
    navigate(homeRouteForRole(session.role), { replace: true });
  }, [selected, pin, busy, navigate, t, setSession]);`,
  `  const submit = reactExports.useCallback(async () => {
    if (!selected || pin.length < 4 || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setPinPhase("busy");
    setError(null);
    const res = await window.pos.auth.login(selected.id, pin);
    if (!res.success) {
      submittingRef.current = false;
      setBusy(false);
      setPin("");
      setPinPhase("err");
      if (res.error.code === "E_PIN_LOCKED") setError(t.login.locked);
      else if (res.error.code === "E_INVALID_PIN") setError(t.login.wrongPin);
      else setError(res.error.message);
      return;
    }
    setPinPhase("ok");
    const session = res.data.session;
    setSession({ ...session, authenticated: true });
    await new Promise((done) => window.setTimeout(done, 420));
    navigate(homeRouteForRole(session.role), { replace: true });
  }, [selected, pin, busy, navigate, t, setSession]);`,
  'staff pin busy/success feedback',
);
s = replaceIfPresent(
  s,
  `    setPinPhase("ok");
    const session = res.data.session;
    setSession({ ...session, authenticated: true });
    await new Promise((done) => window.setTimeout(done, 420));
    navigate(homeRouteForRole(session.role), { replace: true });`,
  `    setPinPhase("ok");
    const session = res.data.session;
    await new Promise((done) => window.setTimeout(done, 420));
    setSession({ ...session, authenticated: true });
    navigate(homeRouteForRole(session.role), { replace: true });`,
  'delay setSession until after success chrome',
);
s = replaceIfPresent(
  s,
  `    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    setPinPhase("busy");
    setError(null);
    const res = await window.pos.auth.login(selected.id, pin);
    if (!res.success) {
      setBusy(false);
      setPin("");
      setPinPhase("err");`,
  `    if (!selected || pin.length < 4 || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setPinPhase("busy");
    setError(null);
    const res = await window.pos.auth.login(selected.id, pin);
    if (!res.success) {
      submittingRef.current = false;
      setBusy(false);
      setPin("");
      setPinPhase("err");`,
  'guard pin double submit',
);
s = replaceIfPresent(
  s,
  `  const resetSelection = reactExports.useCallback(() => {
    setSelected(null);
    setPin("");
    setError(null);
  }, []);`,
  `  const resetSelection = reactExports.useCallback(() => {
    setSelected(null);
    setPin("");
    setError(null);
    setPinPhase("idle");
    submittingRef.current = false;
  }, []);`,
  'reset pin phase',
);
s = replaceIfPresent(
  s,
  `    setError(null);
    setPinPhase("idle");
  }, []);`,
  `    setError(null);
    setPinPhase("idle");
    submittingRef.current = false;
  }, []);`,
  'reset submitting ref',
);
s = replaceIfPresent(
  s,
  `function bindAuthSession() {
  const { setSession, setReady } = useAuthStore.getState();
  const unsubscribe = window.pos.auth.onSession((session) => {
    setSession(session);
    setReady(true);
  });`,
  `function bindAuthSession() {
  const { setSession, setReady } = useAuthStore.getState();
  const unsubscribe = window.pos.auth.onSession((session) => {
    const hold = !!(session && typeof location !== "undefined" && String(location.hash || "").includes("login"));
    if (hold) {
      window.setTimeout(() => {
        setSession(session);
        setReady(true);
      }, 480);
      return;
    }
    setSession(session);
    setReady(true);
  });`,
  'delay onSession setSession on login hash',
);
s = replaceIfPresent(
  s,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-pin-dots my-5 flex items-center", "aria-label": \`\${pin.length} / 4\`, children: [`,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: \`ps-staff-pin-dots my-5 flex items-center\${pinPhase === "busy" ? " is-busy" : pinPhase === "ok" ? " is-ok" : pinPhase === "err" ? " is-err" : ""}\`, "aria-label": \`\${pin.length} / 4\`, children: [`,
  'pin dots phase class',
);
s = replaceIfPresent(
  s,
  `    verifying: "Giriş yoxlanılır…"`,
  `    verifying: "Giriş yoxlanılır…",
    signedIn: "Daxil olundu"`,
  'az signedIn',
);
s = replaceIfPresent(
  s,
  `    verifying: "Verifying access…"`,
  `    verifying: "Verifying access…",
    signedIn: "Signed in"`,
  'en signedIn',
);
s = replaceIfPresent(
  s,
  `    verifying: "Giriş doğrulanıyor…"`,
  `    verifying: "Giriş doğrulanıyor…",
    signedIn: "Giriş yapıldı"`,
  'tr signedIn',
);
s = replaceIfPresent(
  s,
  `                        ) : busy ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] uppercase tracking-[0.18em] text-gold-dim", children: t.login.verifying }) : null })`,
  `                        ) : pinPhase === "ok" ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-ok", children: t.login.signedIn }) : busy ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-staff-pin-busy", children: t.login.verifying }) : null })`,
  'pin status copy',
);
s = replaceIfPresent(
  s,
  `                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "flex min-w-0 flex-col justify-center px-6 py-5 xl:px-9", children: [`,
  `                      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-staff-pin flex min-w-0 flex-col justify-center px-6 py-5 xl:px-9", children: [`,
  'staff pin column',
);
s = replaceIfPresent(
  s,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "mt-2 font-display text-[2rem] leading-none text-cream", children: t.login.pinTitle }),`,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "ps-staff-pin-title mt-2 font-display text-[2rem] leading-none text-cream", children: t.login.pinTitle }),`,
  'staff pin title',
);
s = replaceIfPresent(
  s,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "my-4 flex items-center gap-3", "aria-label": \`\${pin.length} / 4\`, children: [`,
  `                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-staff-pin-dots my-5 flex items-center", "aria-label": \`\${pin.length} / 4\`, children: [`,
  'staff pin dots',
);
s = replaceIfPresent(
  s,
  `                              className: \`grid h-9 w-9 place-items-center rounded-[0.65rem] border transition \${index < pin.length ? "border-gold/65 bg-gold/13 shadow-[inset_0_0_16px_rgba(196,166,106,.08)]" : "border-gold/16 bg-ink/25"}\`,`,
  `                              className: \`ps-staff-pin-cell grid place-items-center \${index < pin.length ? "is-on" : ""}\`,`,
  'staff pin cells',
);
s = replaceIfPresent(
  s,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-1 text-[10px] uppercase tracking-[0.14em] text-faint", children: [
                            pin.length,
                            "/4"
                          ] })`,
  `                          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ps-staff-pin-count", children: [
                            pin.length,
                            "/4"
                          ] })`,
  'staff pin count',
);
s = replaceIfPresent(
  s,
  `  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid w-full max-w-[21rem] grid-cols-3 gap-2.5", "aria-label": "PIN klaviaturası", children: KEYS.map((key) => {`,
  `  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-staff-pad grid w-full max-w-[21.5rem] grid-cols-3", "aria-label": "PIN klaviaturası", children: KEYS.map((key) => {`,
  'staff pin pad',
);
s = replaceIfPresent(
  s,
  `        className: \`pin-key touch-target group relative flex h-[4.15rem] items-center justify-center overflow-hidden rounded-[0.85rem] border text-2xl font-medium tabular-nums transition focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-25 \${action ? "border-gold/12 bg-ink/24 text-gold-dim hover:border-gold/35 hover:text-gold-light" : "border-gold/22 bg-elevated/82 text-cream hover:-translate-y-0.5 hover:border-gold/55 hover:bg-raised"}\`,`,
  `        className: \`pin-key ps-staff-key touch-target group relative flex items-center justify-center overflow-hidden tabular-nums transition focus-visible:z-10 disabled:cursor-not-allowed disabled:opacity-25 \${action ? "ps-staff-key--action" : ""}\`,`,
  'staff pin keys',
);
s = replaceIfPresent(
  s,
  `                            className: "flex max-w-[21rem] items-center gap-2 rounded-lg border border-danger/28 bg-danger/8 px-3 py-2 text-xs text-danger",`,
  `                            className: "ps-staff-pin-error flex max-w-[21.5rem] items-center gap-2",`,
  'staff pin error',
);

const startHelp = s.indexOf('function receiptHtmlLooksUseful');
if (startHelp >= 0) {
  const after = s.indexOf('function buildReceiptMockHtml', startHelp);
  must(after > startHelp, 'buildReceiptMockHtml after useful missing');
  s = s.slice(0, startHelp) + `function receiptHtmlLooksUseful(html) {
  const raw = String(html || "").replace(/<img\\b[^>]*>/gi, " ");
  const text = raw.replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\\s+/g, " ").trim();
  if (text.length < 20) return false;
  if (/loqo|logo|possistem/i.test(text) && !/[₼]|Cəmi|Total/i.test(text)) return false;
  if (/^[\\d\\s·.•mm×xsütun]+$/i.test(text)) return false;
  const hasMoney = /[₼]|\\d+[.,]\\d{2}/.test(text);
  const hasTotal = /Cəmi|Total|Yekun/i.test(text);
  const hasRow = /Club Sandwich|Kartof|Çay|məhsul|Sandwich|Fri/i.test(text);
  return hasMoney && hasTotal && hasRow;
}
function stripReceiptImages(html) {
  return String(html || "").replace(/<img\\b[^>]*>/gi, "");
}
function paperizeReceiptHtml(html) {
  const cleaned = stripReceiptImages(html);
  const reset = \`<style>html,body{margin:0;background:#f8f4ea!important;color:#111827!important}img,canvas{display:none!important}</style>\`;
  if (/<head/i.test(cleaned)) return cleaned.replace(/<head[^>]*>/i, (m) => m + reset);
  return \`<!doctype html><html><head><meta charset="utf-8">\${reset}</head><body>\${cleaned}</body></html>\`;
}
` + s.slice(after);
} else if (s.includes('function buildReceiptMockHtml')) {
  s = s.replace(
    'function buildReceiptMockHtml',
    `function receiptHtmlLooksUseful(html) {
  const raw = String(html || "").replace(/<img\\b[^>]*>/gi, " ");
  const text = raw.replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\\s+/g, " ").trim();
  if (text.length < 20) return false;
  if (/loqo|logo|possistem/i.test(text) && !/[₼]|Cəmi|Total/i.test(text)) return false;
  const hasMoney = /[₼]|\\d+[.,]\\d{2}/.test(text);
  const hasTotal = /Cəmi|Total|Yekun/i.test(text);
  const hasRow = /Club Sandwich|Kartof|Çay|məhsul|Sandwich|Fri/i.test(text);
  return hasMoney && hasTotal && hasRow;
}
function stripReceiptImages(html) {
  return String(html || "").replace(/<img\\b[^>]*>/gi, "");
}
function paperizeReceiptHtml(html) {
  const cleaned = stripReceiptImages(html);
  const reset = \`<style>html,body{margin:0;background:#f8f4ea!important;color:#111827!important}img,canvas{display:none!important}</style>\`;
  if (/<head/i.test(cleaned)) return cleaned.replace(/<head[^>]*>/i, (m) => m + reset);
  return \`<!doctype html><html><head><meta charset="utf-8">\${reset}</head><body>\${cleaned}</body></html>\`;
}
function buildReceiptMockHtml`,
  );
}

const rp = s.indexOf('  const runPreview = async () => {');
if (rp >= 0) {
  const end = s.indexOf('  const savePrintTuning = async () => {', rp);
  must(end > rp, 'savePrintTuning after runPreview missing');
  s = s.slice(0, rp) + `  const runPreview = async () => {
    setPreviewing(true);
    const meta = \`\${paperWidth} mm · \${charsPerLine} sütun\`;
    let html = "";
    setPreviewMeta(meta);
    try {
      const api = window.pos && window.pos.print && window.pos.print.previewTest;
      if (typeof api === "function") {
        const res = await api({ paperWidth, charsPerLine, renderMode, fontHeightPx, fontWidthPx, sideMarginPx });
        if (res && res.success && res.data) {
          const raw = stripReceiptImages(res.data.html != null ? String(res.data.html) : "");
          if (receiptHtmlLooksUseful(raw)) html = paperizeReceiptHtml(raw);
          if (res.data.paperWidth || res.data.charsPerLine) {
            setPreviewMeta(\`\${res.data.paperWidth ?? paperWidth} mm · \${res.data.charsPerLine ?? charsPerLine} sütun\`);
          }
        }
      }
    } catch {
    }
    if (!html || !receiptHtmlLooksUseful(html)) html = buildReceiptMockHtml(meta);
    setPreviewHtml(html);
    setPreviewing(false);
  };
` + s.slice(end);
}

if (!s.includes('ps-receipt-ticket') && !laterReceiptChrome) {
  s = replaceOnce(
    s,
    `        /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: t.settings.previewReceipt, className: "ps-receipt-frame", srcDoc: previewHtml })`,
    `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-frame", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "Nümunə restoran" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ps-receipt-ticket-meta", children: [previewMeta || "80 mm · 40 sütun", /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}), "Masa 12 · Nümunə çek"] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Club Sandwich" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "9.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Kartof fri" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "4.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Çay" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "2.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row is-total", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Cəmi" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "15.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: "Çek önbaxış · kağız nümunə" })
          ] })
        ] })`,
    'in-DOM paper ticket',
  );
}

must(/ps-rest-staff-brand[\s\S]{0,700}ps-brand-lockup--tile/.test(s), 'staff brand tile missing after patch');
must(s.includes('ps-staff-pick'), 'staff pick class missing');
must(s.includes('ps-staff-pin'), 'staff pin class missing');
must(s.includes('ps-staff-identity-card'), 'identity card missing');
must(s.includes('ps-staff-pin-count'), 'pin count class missing');
must(s.includes('ps-staff-initials'), 'initials avatar missing');
must(s.includes('setPinPhase("ok")') && s.includes('setPinPhase("busy")'), 'pin phase feedback missing');
must(s.includes('submittingRef'), 'pin double-submit guard missing');
must(s.includes('includes("login")'), 'onSession login hold missing');
must(s.includes('await new Promise((done) => window.setTimeout(done, 420));\n    setSession({ ...session, authenticated: true })'), 'submit delays setSession');
must(s.includes('signedIn: "Daxil olundu"'), 'az signedIn missing');
must(!s.includes('className: `ps-brand-lockup ps-brand-lockup--emblem'), 'admin emblem tile remains');
must(!/function RoleEmblem[\s\S]{0,900}brandMark/.test(s), 'RoleEmblem still uses brand logo');
must(!/ps-staff-identity-card[\s\S]{0,400}ps-brand-lockup/.test(s), 'PIN identity still has brand lockup');
must(!/ps-staff-identity-card[\s\S]{0,400}brandMark/.test(s), 'PIN identity still has brandMark');
if (!laterReceiptChrome) {
  must(s.includes('stripReceiptImages'), 'strip helper missing');
  must(s.includes('img,canvas{display:none!important}'), 'paperize still paints imgs');
  must(s.includes('if (!html || !receiptHtmlLooksUseful(html)) html = buildReceiptMockHtml(meta);'), 'mock fallback missing');
  must(s.includes('ps-receipt-ticket'), 'paper ticket missing');
}

if (!s.includes('/* POS_FIX_v3 */')) {
  s = s.replace('/* POS_FIX_v2 */', `/* POS_FIX_v2 */\n/* POS_FIX_v3 */`);
  if (!s.includes('/* POS_FIX_v3 */')) s = s.replace('/* POS_FIX_v1 */', `/* POS_FIX_v1 */\n/* POS_FIX_v3 */`);
}
if (!s.includes('/* POS_FIX_v4 */')) {
  s = s.replace('/* POS_FIX_v3 */', `/* POS_FIX_v3 */\n/* POS_FIX_v4 */`);
}
if (!s.includes('/* POS_FIX_v5 */')) {
  s = s.replace('/* POS_FIX_v4 */', `/* POS_FIX_v4 */\n/* POS_FIX_v5 */`);
}
if (!s.includes('/* POS_FIX_v6 */')) {
  s = s.replace('/* POS_FIX_v5 */', `/* POS_FIX_v5 */\n/* POS_FIX_v6 */`);
}
if (!s.includes(MARK)) {
  s = s.replace('/* POS_FIX_v6 */', `/* POS_FIX_v6 */\n${MARK}`);
}
must(s.includes(MARK), 'v7 mark');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
