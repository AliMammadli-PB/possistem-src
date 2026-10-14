#!/usr/bin/env node
/**
 * 1.7.24 — Obyektlər as their own section (Əməliyyatlar → Obyektlər).
 *
 * Create a branch, rename it, and see per branch its kassas, their balance and
 * today's cash / card. Same data as Kassalar (cashAccounts.list,
 * cashObjects.save); no core change. Runs after apply-restaurant-cash-accounts.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_OBJECTS_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, 'function OpsKassalar() {', `${MARK}
function OpsObjects() {
  const h = psH;
  const [data, setData] = reactExports.useState(null);
  const [form, setForm] = reactExports.useState(null);
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canManage = hasPermission("cash.accounts");
  const reload = reactExports.useCallback(async () => {
    const [from, to] = psToday();
    const r = await window.pos.cashAccounts.list(from, to);
    if (r.success) { _psAccountsCache = r.data; setData(r.data); } else toast(r.error.message, "danger");
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!data) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");

  const groups = [...data.objects.map((o) => ({ id: o.id, name: o.name, accounts: data.accounts.filter((a) => a.objectId === o.id) })),
    { id: "", name: "Obyektsiz", accounts: data.accounts.filter((a) => !a.objectId) }].filter((g) => g.id || g.accounts.length);
  const total = (list, key) => list.reduce((t, a) => t + (Number(a[key]) || 0), 0);
  const tills = (list) => list.filter((a) => a.kind === "till");
  const save = () => {
    if (!form.name.trim()) { toast("Obyektin adını yazın", "danger"); return; }
    void run(window.pos.cashAccounts.saveObject({ ...(form.id ? { id: form.id } : {}), name: form.name.trim() }),
      form.id ? "Saxlanıldı" : "Obyekt yaradıldı").then((ok) => { if (ok) setForm(null); });
  };

  return h("div", { className: "space-y-4" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      h("p", { className: "text-sm text-muted" }, data.objects.length + " obyekt · kassaları Kassalar bölməsində obyektə bağlayın"),
      h("span", { className: "ml-auto" }),
      canManage ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ name: "" }), children: "+ Yeni obyekt" }) : null),

    groups.length ? h("div", { className: "ps-kassa-grid" }, groups.map((g) =>
      h("article", { key: g.id || "none", className: "ps-kassa-card ps-object-card" },
        h("div", { className: "ps-kassa-head" },
          h("b", null, g.name),
          h("span", { className: "ps-kassa-kind" }, g.accounts.length + " kassa")),
        h("p", { className: "ps-kassa-balance" }, formatMoney(total(g.accounts, "balanceMinor"))),
        h("p", { className: "ps-kassa-today" }, "Bu gün: nağd " + formatMoney(total(tills(g.accounts), "todayCashMinor")) + " · kart " + formatMoney(total(tills(g.accounts), "todayCardMinor"))),
        h("p", { className: "ps-kassa-meta" }, g.accounts.length ? g.accounts.map((a) => a.name + " (" + PS_KASSA_KINDS[a.kind] + ")").join(" · ") : "Hələ kassa bağlanmayıb"),
        canManage && g.id ? h("div", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm({ id: g.id, name: g.name }), children: "Adını dəyiş" })) : null)))
      : h("p", { className: "ps-recipe-note" }, "Hələ obyekt yoxdur. \\"+ Yeni obyekt\\" ilə filial yaradın (məs. Filial 1, Nərimanov)."),

    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Obyektin adını dəyiş" : "Yeni obyekt", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      jsxRuntimeExports.jsx(OpsField, { label: "Obyektin adı", value: form.name, onChange: (v) => setForm({ ...form, name: v }), placeholder: "məs. Filial 2, Nərimanov" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

function OpsKassalar() {`, 'objects component');

  s = replaceOnce(s,
    `    { id: "kassa", label: "Kassalar", show: hasPermission("cash.manage"),`,
    `    { id: "objects", label: "Obyektlər", show: hasPermission("cash.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsObjects, {}) },
    { id: "kassa", label: "Kassalar", show: hasPermission("cash.manage"),`,
    'objects tab');
  fs.writeFileSync(BUNDLE, s);
  console.log('objects applied');
}

// Titles (apply-restaurant-admin-refresh.mjs rewrites these maps on every assemble).
{
  let t = fs.readFileSync(BUNDLE, 'utf8');
  if (!t.includes('objects: ["Obyektlər"')) {
    t = replaceOnce(t, 'kassa: ["Kassalar", "Kasalar", "Tills"]', 'objects: ["Obyektlər", "Şubeler", "Branches"], kassa: ["Kassalar", "Kasalar", "Tills"]', 'objects title');
    t = replaceOnce(t, '    kassa: ["Kassalar, xəzinə və bank',
      '    objects: ["Filiallar — hər birinin kassaları, balansı və bugünkü satışı.", "Şubeler ve kasaları.", "Branches and their tills."],\n    kassa: ["Kassalar, xəzinə və bank',
      'objects subtitle');
    fs.writeFileSync(BUNDLE, t);
    console.log('objects: tab titles');
  }
}
