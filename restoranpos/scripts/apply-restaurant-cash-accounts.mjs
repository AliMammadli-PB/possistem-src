#!/usr/bin/env node
/**
 * 1.7.23 — Kassalar.
 *
 *  - main: every core frame says which PC it came from (`terminal`
 *    {id, name}; id is stable per PC, name the portal's device name or the
 *    host name). A LAN terminal sends its own, the host passes it through, so
 *    a sale rung up on the second till lands in the second till's kassa.
 *  - Əməliyyatlar → Kassalar: tills (tied to a sales point), the treasury and
 *    the bank, grouped by branch (obyekt); balance and today's cash / card;
 *    opening balance on create; transfers between kassas; per-kassa moves.
 *  - A kassa picker on every money screen: Maaşlar, Partnyorlar (borcu ödə),
 *    Təchizatçılar (ödə), Xərclər, Kassa (mədaxil / məxaric).
 * Runs after apply-restaurant-partners.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_KASSA_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

// ------------------------------------------------------------------ main
{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes(MARK)) {
    // Which PC this is: stable across restarts, named after the portal device.
    m = replaceOnce(m, 'var PS_LAN_PORT=43180;',
      `var PS_LAN_PORT=43180;
${MARK}
function _psTerminal(){if(!globalThis.__psTerminal){let id="pc-unknown",name="Kompüter";try{name=Bt.hostname()||name;id="pc-"+W.createHash("sha1").update(name+"|"+c.app.getPath("userData")).digest("hex").slice(0,12)}catch{}globalThis.__psTerminal={id,name}}return globalThis.__psTerminal}`,
      'main terminal identity');
    m = replaceOnce(m, 'function _psLanApply(device,persist=true){const dv=device&&typeof device==="object"?device:{};',
      'function _psLanApply(device,persist=true){const dv=device&&typeof device==="object"?device:{};{const nm=typeof dv.name==="string"&&dv.name.trim()?dv.name.trim():typeof dv.label==="string"&&dv.label.trim()?dv.label.trim():"";if(nm)_psTerminal().name=nm.slice(0,120)}',
      'main terminal name from portal');
    m = replaceOnce(m, 's?.actor&&(a.actor=s.actor);',
      's?.actor&&(a.actor=s.actor);a.terminal=s?.terminal||_psTerminal();',
      'main envelope terminal');
    m = replaceOnce(m, 'const body=JSON.stringify({method,payload,actor:{userId:_psLan.actor||""},',
      'const body=JSON.stringify({method,payload,actor:{userId:_psLan.actor||""},terminal:opts?.terminal||_psTerminal(),',
      'lan terminal sends its own terminal');
    m = replaceOnce(m, '{lanLocal:true,actor:{userId:actor},timeoutMs,',
      '{lanLocal:true,actor:{userId:actor},terminal:q.terminal&&typeof q.terminal==="object"?{id:String(q.terminal.id||"").slice(0,80),name:String(q.terminal.name||"").slice(0,120)}:void 0,timeoutMs,',
      'lan host passes the terminal through');
    m = replaceOnce(m, 'Cn={',
      `Cn={"cashAccounts.list":{auth:!0,perm:"cash.manage",timeout:8e3,idempotent:!1},"cashAccounts.save":{auth:!0,perm:"cash.accounts",timeout:5e3,idempotent:!0},"cashAccounts.deactivate":{auth:!0,perm:"cash.accounts",timeout:5e3,idempotent:!0},"cashAccounts.moves":{auth:!0,perm:"cash.manage",timeout:8e3,idempotent:!1},"cashAccounts.transfer":{auth:!0,perm:"cash.accounts",timeout:5e3,idempotent:!0},"cashObjects.save":{auth:!0,perm:"cash.accounts",timeout:5e3,idempotent:!0},`,
      'main policy table');
    fs.writeFileSync(MAIN, m);
    console.log('main: terminal identity, kassa methods');
  }
}

// --------------------------------------------------------------- preload
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('cashAccounts.list')) {
    p = replaceOnce(p, '  salary: {',
      `  cashAccounts: {
    list: (from, to) => call("cashAccounts.list", { from, to }),
    save: (input, options) => call("cashAccounts.save", input, options),
    deactivate: (accountId) => call("cashAccounts.deactivate", { accountId }),
    moves: (accountId) => call("cashAccounts.moves", { accountId }),
    transfer: (input, options) => call("cashAccounts.transfer", input, options),
    saveObject: (input) => call("cashObjects.save", input)
  },

  salary: {`, 'preload cashAccounts');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: cashAccounts');
  }
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  // ------------------------------------------------- shared kassa picker
  s = replaceOnce(s, 'const PS_PARTNER_TYPES = {', `${MARK}
let _psAccountsCache = null;
const PS_KASSA_KINDS = { till: "Kassa", treasury: "Xəzinə", bank: "Bank" };
function psToday() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return [from, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()];
}
function usePsAccounts() {
  const [data, setData] = reactExports.useState(_psAccountsCache);
  reactExports.useEffect(() => {
    let alive = true;
    const [from, to] = psToday();
    void window.pos.cashAccounts.list(from, to).then((r) => { if (alive && r.success) { _psAccountsCache = r.data; setData(r.data); } });
    return () => { alive = false; };
  }, []);
  return data;
}
/** Picks the kassa / treasury / bank a payment goes in or out of; this PC's till by default. */
function PsAccountSelect({ value, onChange, label }) {
  const data = usePsAccounts();
  reactExports.useEffect(() => {
    if (!data || value !== undefined) return;
    const mine = data.accounts.find((a) => a.kind === "till" && a.terminalId === data.currentTerminalId);
    onChange(mine ? mine.id : "");
  }, [data]);
  return psH("label", { className: "block text-sm" },
    psH("span", { className: "text-xs uppercase tracking-wide text-faint" }, label || "Kassa / xəzinə"),
    psH("select", { value: value || "", onChange: (e) => onChange(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream" },
      psH("option", { value: "" }, "— Kassa seçilməyib —"),
      (data?.accounts ?? []).map((a) => psH("option", { key: a.id, value: a.id },
        a.name + " · " + PS_KASSA_KINDS[a.kind] + (a.objectName ? " · " + a.objectName : "") + " — " + formatMoney(a.balanceMinor ?? 0)))));
}

function OpsKassalar() {
  const h = psH;
  const [data, setData] = reactExports.useState(null);
  const [objectId, setObjectId] = reactExports.useState("all");
  const [form, setForm] = reactExports.useState(null);
  const [objForm, setObjForm] = reactExports.useState(null);
  const [transfer, setTransfer] = reactExports.useState(null);
  const [moves, setMoves] = reactExports.useState(null);
  const [confirmAsk, confirmDialog] = useConfirm();
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

  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  const accounts = data.accounts.filter((a) => objectId === "all" || (objectId === "none" ? !a.objectId : a.objectId === objectId));
  const sum = (k) => accounts.reduce((t, a) => t + (Number(a[k]) || 0), 0);
  const termName = (id) => { const t = data.terminals.find((x) => x.id === id); return t ? t.name + (t.current && t.name !== "Bu kompüter" ? " (bu kompüter)" : "") : id; };
  const openMoves = async (a) => {
    const r = await window.pos.cashAccounts.moves(a.id);
    if (r.success) setMoves({ account: a, rows: r.data.moves ?? [] }); else toast(r.error.message, "danger");
  };
  const MOVE = { opening: "İlkin qalıq", transfer: "Transfer", salary: "Maaş", debt_in: "Borc alındı", supplier: "Təchizatçıya ödəniş", expense: "Xərc", cash_in: "Mədaxil", cash_out: "Məxaric", float_adjust: "Düzəliş", adjust: "Düzəliş" };

  const saveKassa = () => {
    if (!form.name.trim()) { toast("Kassanın adını yazın", "danger"); return; }
    if (!form.id && !psStockInputValid(form.opening || "0", { empty: true })) { toast("İlkin qalığı düzgün yazın", "danger"); return; }
    void run(window.pos.cashAccounts.save({
      ...(form.id ? { id: form.id } : { openingMinor: opsMinor(form.opening || "0") }),
      name: form.name.trim(), kind: form.kind, objectId: form.objectId || "", terminalId: form.kind === "till" ? form.terminalId || "" : ""
    }, { idempotencyKey: newIdempotencyKey() }), form.id ? "Saxlanıldı" : "Kassa yaradıldı").then((ok) => { if (ok) setForm(null); });
  };
  const saveTransfer = () => {
    if (!transfer.fromId || !transfer.toId || transfer.fromId === transfer.toId) { toast("İki fərqli kassa seçin", "danger"); return; }
    if (!psStockInputValid(transfer.value) || opsMinor(transfer.value) <= 0) { toast("Məbləği yazın", "danger"); return; }
    void run(window.pos.cashAccounts.transfer({ fromId: transfer.fromId, toId: transfer.toId, amountMinor: opsMinor(transfer.value), note: transfer.note.trim() },
      { idempotencyKey: newIdempotencyKey() }), "Transfer edildi").then((ok) => { if (ok) setTransfer(null); });
  };
  const remove = async (a) => {
    if (!(await confirmAsk('"' + a.name + '" bağlansın? Kassada pul qalmamalıdır.', { danger: true }))) return;
    void run(window.pos.cashAccounts.deactivate(a.id), "Bağlandı");
  };
  const option = (a) => h("option", { key: a.id, value: a.id }, a.name + " · " + PS_KASSA_KINDS[a.kind] + " — " + formatMoney(a.balanceMinor ?? 0));
  const metric = (label, value, sub, tone) => h("div", { key: label, className: "ps-stock-metric" },
    h("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, label),
    h("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream", style: tone ? { color: tone } : null }, value),
    h("p", { className: "mt-1 text-[11px] text-muted" }, sub));

  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      metric("Ümumi balans", formatMoney(sum("balanceMinor")), accounts.length + " kassa"),
      metric("Bu gün nağd", formatMoney(sum("todayCashMinor")), "Kassalara düşən"),
      metric("Bu gün kart", formatMoney(accounts.filter((a) => a.kind === "till").reduce((t, a) => t + (Number(a.todayCardMinor) || 0), 0)), "Satış nöqtələri üzrə"),
      metric("Bu gün cəmi satış", formatMoney(accounts.filter((a) => a.kind === "till").reduce((t, a) => t + (Number(a.todayCashMinor) || 0) + (Number(a.todayCardMinor) || 0), 0)), "Nağd + kart", "var(--ps-ok)")),

    (data.unassigned ?? []).length ? h("div", { className: "ps-neg-banner" },
      h("b", null, "Kassaya bağlı olmayan satış nöqtəsi: "),
      data.unassigned.map((u) => (u.name || u.terminalId) + " — bu gün nağd " + formatMoney(u.cashMinor) + ", kart " + formatMoney(u.cardMinor)).join(" · "),
      h("span", null, ". Kassa yaradıb bu nöqtəyə bağlayın.")) : null,

    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["all", "Hamısı"], ...data.objects.map((o) => [o.id, o.name]), ...(data.objects.length ? [["none", "Obyektsiz"]] : [])].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": objectId === k, className: "ps-period-chip" + (objectId === k ? " is-on" : ""), onClick: () => setObjectId(k) }, l)),
      canManage ? h("button", { type: "button", className: "ps-link-btn", onClick: () => setObjForm({ name: "" }) }, "+ Obyekt") : null,
      h("span", { className: "ml-auto" }),
      canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setTransfer({ fromId: "", toId: "", value: "", note: "" }), children: "Kassalar arası transfer" }) : null,
      canManage ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ name: "", kind: "till", objectId: objectId !== "all" && objectId !== "none" ? objectId : "", terminalId: data.accounts.some((a) => a.terminalId === data.currentTerminalId) ? "" : data.currentTerminalId, opening: "" }), children: "+ Yeni kassa" }) : null),

    accounts.length ? h("div", { className: "ps-kassa-grid" }, accounts.map((a) =>
      h("article", { key: a.id, className: "ps-kassa-card ps-kassa-" + a.kind },
        h("div", { className: "ps-kassa-head" },
          h("b", null, a.name),
          h("span", { className: "ps-kassa-kind" }, PS_KASSA_KINDS[a.kind])),
        h("p", { className: "ps-kassa-meta" },
          [a.objectName ? "Obyekt: " + a.objectName : "", a.kind === "till" ? (a.terminalId ? "Satış nöqtəsi: " + termName(a.terminalId) : "Satış nöqtəsi bağlanmayıb") : ""].filter(Boolean).join(" · ") || "—"),
        h("p", { className: "ps-kassa-balance" }, formatMoney(a.balanceMinor ?? 0)),
        a.kind === "till" ? h("p", { className: "ps-kassa-today" }, "Bu gün: nağd " + formatMoney(a.todayCashMinor ?? 0) + " · kart " + formatMoney(a.todayCardMinor ?? 0))
          : a.kind === "bank" ? h("p", { className: "ps-kassa-today" }, "Bu gün kart: " + formatMoney(a.todayCardMinor ?? 0)) : null,
        h("div", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openMoves(a), children: "Hərəkətlər" }),
          canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm({ id: a.id, name: a.name, kind: a.kind, objectId: a.objectId || "", terminalId: a.terminalId || "" }), children: "Redaktə" }) : null,
          canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void remove(a), children: "Bağla" }) : null))))
      : h("p", { className: "ps-recipe-note" }, "Hələ kassa yoxdur. \\"+ Yeni kassa\\" ilə satış nöqtəsinin kassasını, xəzinəni və bankı yaradın."),

    moves ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, moves.account.name + " — hərəkətlər (satışlardan başqa)"),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setMoves(null), children: "Bağla" })),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Məbləğ", "Qeyd", "Kim"], empty: "Hərəkət yoxdur",
        rows: moves.rows.map((e) => [opsWhen(e.createdAt), MOVE[e.kind] || e.kind,
          h("b", { style: { color: (e.amountMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, ((e.amountMinor ?? 0) < 0 ? "−" : "+") + formatMoney(Math.abs(e.amountMinor ?? 0))),
          e.note || "—", e.actorName || "—"]) })) : null,

    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Kassanı redaktə et" : "Yeni kassa", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }), placeholder: "məs. Kassa 1, Xəzinə" }),
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Növ"),
          h("select", { value: form.kind, disabled: Boolean(form.id), className: field, onChange: (e) => setForm({ ...form, kind: e.target.value }) },
            Object.entries(PS_KASSA_KINDS).map(([k, l]) => h("option", { key: k, value: k }, l)))),
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Obyekt (filial)"),
          h("select", { value: form.objectId, className: field, onChange: (e) => setForm({ ...form, objectId: e.target.value }) },
            h("option", { value: "" }, "— Obyektsiz —"), data.objects.map((o) => h("option", { key: o.id, value: o.id }, o.name)))),
        form.kind === "till" ? h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Satış nöqtəsi (kompüter)"),
          h("select", { value: form.terminalId, className: field, onChange: (e) => setForm({ ...form, terminalId: e.target.value }) },
            h("option", { value: "" }, "— Bağlanmayıb —"),
            data.terminals.map((t) => h("option", { key: t.id, value: t.id }, t.name + (t.current && t.name !== "Bu kompüter" ? " (bu kompüter)" : ""))))) : null,
        !form.id ? jsxRuntimeExports.jsx(OpsField, { label: "İlkin qalıq (₼)", value: form.opening, onChange: (v) => setForm({ ...form, opening: v }), placeholder: "0.00" }) : null),
      h("p", { className: "text-xs text-muted" }, form.kind === "till"
        ? "Bağlandığı kompüterdə alınan nağd pul bu kassaya düşür. Digər kompüter siyahıda yoxdursa, o kompüterdə bir satış edin — avtomatik görünəcək."
        : form.kind === "bank" ? "Kartla alınan pul banka düşür (obyekt seçilibsə, yalnız o obyektin kassalarından)." : "Xəzinəyə pul transferlə gəlir və çıxır."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveKassa, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null,

    objForm ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni obyekt (filial)", onClose: () => setObjForm(null), busy, children: h("div", { className: "space-y-3" },
      jsxRuntimeExports.jsx(OpsField, { label: "Obyektin adı", value: objForm.name, onChange: (v) => setObjForm({ name: v }), placeholder: "məs. Filial 2, Nərimanov" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => { if (!objForm.name.trim()) { toast("Adı yazın", "danger"); return; } void run(window.pos.cashAccounts.saveObject({ name: objForm.name.trim() }), "Obyekt yaradıldı").then((ok) => { if (ok) setObjForm(null); }); }, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setObjForm(null), children: "İmtina" }))) }) : null,

    transfer ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Kassalar arası transfer", onClose: () => setTransfer(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Haradan"),
          h("select", { value: transfer.fromId, className: field, onChange: (e) => setTransfer({ ...transfer, fromId: e.target.value }) }, h("option", { value: "" }, "Seçin…"), data.accounts.map(option))),
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Haraya"),
          h("select", { value: transfer.toId, className: field, onChange: (e) => setTransfer({ ...transfer, toId: e.target.value }) }, h("option", { value: "" }, "Seçin…"), data.accounts.filter((a) => a.id !== transfer.fromId).map(option))),
        jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: transfer.value, onChange: (v) => setTransfer({ ...transfer, value: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: transfer.note, onChange: (v) => setTransfer({ ...transfer, note: v }), placeholder: "məs. axşam inkassasiya" })),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveTransfer, children: "Transfer et" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setTransfer(null), children: "İmtina" }))) }) : null,
    confirmDialog);
}

const PS_PARTNER_TYPES = {`, 'kassa components');

  // Tab
  s = replaceOnce(s,
    `    { id: "salary", label: "Maaşlar", show: hasPermission("salary.manage"),`,
    `    { id: "kassa", label: "Kassalar", show: hasPermission("cash.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsKassalar, {}) },
    { id: "salary", label: "Maaşlar", show: hasPermission("salary.manage"),`,
    'kassa tab');

  // ------------------------------------------------------------ Maaşlar
  s = replaceOnce(s,
    `fromCash: ask.kind !== "note" && ask.fromCash },`,
    `accountId: ask.kind !== "note" ? ask.accountId || "" : "" },`,
    'salary account payload');
  s = replaceOnce(s,
    `              ask.kind !== "note" ? h("label", { className: "flex items-center gap-2 text-sm text-cream" },
                h("input", { type: "checkbox", checked: ask.fromCash, onChange: (e) => setAsk({ ...ask, fromCash: e.target.checked }) }),
                "Kassadan çıxsın (Xərclərdə görünür)") : null),`,
    `              ask.kind !== "note" ? jsxRuntimeExports.jsx(PsAccountSelect, { value: ask.accountId, onChange: (v) => setAsk((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan / xəzinədən ödənilir" }) : null),`,
    'salary account picker');

  // ------------------------------------------------------- Partnyorlar
  s = replaceOnce(s,
    `window.pos.guests.payDebt({ customerId: ask.person.id, amountMinor: opsMinor(ask.value) })`,
    `window.pos.guests.payDebt({ customerId: ask.person.id, amountMinor: opsMinor(ask.value), accountId: ask.accountId || "" })`,
    'debt account payload');
  s = replaceOnce(s,
    `      h("p", { className: "text-xs text-muted" }, "Cari borc: " + formatMoney(ask.person.debtMinor ?? 0)),
      jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) }),`,
    `      h("p", { className: "text-xs text-muted" }, "Cari borc: " + formatMoney(ask.person.debtMinor ?? 0)),
      jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) }),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: ask.accountId, onChange: (v) => setAsk((p) => (p ? { ...p, accountId: v } : p)), label: "Pul hansı kassaya girir" }),`,
    'debt account picker');

  // ------------------------------------------------------ Təchizatçılar
  s = replaceOnce(s,
    `window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value) })`,
    `window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value), accountId: pay.accountId || "" })`,
    'supplier account payload');
  s = replaceOnce(s,
    `/* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: pay.value, onChange: (v) => setPay({ ...pay, value: v }) }),`,
    `/* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: pay.value, onChange: (v) => setPay({ ...pay, value: v }) }),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: pay.accountId, onChange: (v) => setPay((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan ödənilir" }),`,
    'supplier account picker');

  // ------------------------------------------------------------ Xərclər
  s = replaceOnce(s,
    `window.pos.cash.movement({ kind: "expense", amountMinor: opsMinor(form.value), reason, note: form.note.trim() }`,
    `window.pos.cash.movement({ kind: "expense", amountMinor: opsMinor(form.value), reason, note: form.note.trim(), accountId: form.accountId || "" }`,
    'expense account payload');
  s = replaceOnce(s,
    `      h("p", { className: "text-xs text-muted" }, "Pul kassadan çıxır və X hesabatda görünür."),`,
    `      jsxRuntimeExports.jsx(PsAccountSelect, { value: form.accountId, onChange: (v) => setForm((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan / xəzinədən" }),
      h("p", { className: "text-xs text-muted" }, "Pul seçilən kassadan çıxır və X hesabatda görünür."),`,
    'expense account picker');

  // ------------------------------------------------- Kassa (mədaxil/məxaric)
  s = replaceOnce(s,
    `  const [reason, setReason] = reactExports.useState("");
  const [note, setNote] = reactExports.useState("");
  const refresh = reactExports.useCallback(async () => {
    const dayRes = await window.pos.businessDay.current();`,
    `  const [reason, setReason] = reactExports.useState("");
  const [note, setNote] = reactExports.useState("");
  const [accountId, setAccountId] = reactExports.useState(void 0);
  const refresh = reactExports.useCallback(async () => {
    const dayRes = await window.pos.businessDay.current();`,
    'cash page account state');
  s = replaceOnce(s,
    `        note: note.trim() || void 0,
        businessDayId: businessDayId ?? void 0
      },`,
    `        note: note.trim() || void 0,
        businessDayId: businessDayId ?? void 0,
        accountId: accountId || ""
      },`,
    'cash page account payload');
  s = replaceOnce(s,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.cash.note }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                value: note,
                onChange: (e) => setNote(e.target.value),
                className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50"
              }
            )
          ] })`,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.cash.note }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                value: note,
                onChange: (e) => setNote(e.target.value),
                className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sm:col-span-2", children: jsxRuntimeExports.jsx(PsAccountSelect, { value: accountId, onChange: setAccountId }) })`,
    'cash page account picker');

  fs.writeFileSync(BUNDLE, s);
  console.log('kassalar applied');
}

// Titles for the tab (admin-refresh rewrites these maps on every assemble).
{
  let t = fs.readFileSync(BUNDLE, 'utf8');
  if (!t.includes('kassa: ["Kassalar"')) {
    t = replaceOnce(t, 'salary: ["Maaşlar", "Maaşlar", "Salaries"]', 'kassa: ["Kassalar", "Kasalar", "Tills"], salary: ["Maaşlar", "Maaşlar", "Salaries"]', 'kassa title');
    t = replaceOnce(t, '    salary: ["İşçilərin aylıq maaşı',
      '    kassa: ["Kassalar, xəzinə və bank — balans, gündəlik satış və transferlər.", "Kasalar, hazine ve banka.", "Tills, treasury and bank."],\n    salary: ["İşçilərin aylıq maaşı',
      'kassa subtitle');
    fs.writeFileSync(BUNDLE, t);
    console.log('kassalar: tab titles');
  }
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(MARK)) {
  css += `
${MARK}
.ps-kassa-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.ps-kassa-card { display: grid; gap: 0.45rem; padding: 1rem 1.1rem; border: 1px solid var(--ps-line, #e2e8f0); border-left: 4px solid #2563eb; border-radius: 0.9rem; background: #fff; }
.ps-kassa-treasury { border-left-color: #a16207; }
.ps-kassa-bank { border-left-color: #0f766e; }
.ps-kassa-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.ps-kassa-head b { font-size: 1.05rem; }
.ps-kassa-kind { padding: 0.15rem 0.55rem; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 0.72rem; font-weight: 700; }
.ps-kassa-treasury .ps-kassa-kind { background: #fdf4e3; color: #a16207; }
.ps-kassa-bank .ps-kassa-kind { background: #ecfdf5; color: #0f766e; }
.ps-kassa-meta { margin: 0; font-size: 0.8rem; color: #64748b; }
.ps-kassa-balance { margin: 0; font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.ps-kassa-today { margin: 0; font-size: 0.85rem; color: #0f766e; font-weight: 650; }
`;
  fs.writeFileSync(CSS, css);
}
