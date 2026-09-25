#!/usr/bin/env node
/**
 * Roles and permissions, edited in the app.
 *
 * Roles were six rows the seed wrote, and a grant could only be changed by
 * editing SQL — "let this manager refund" had no answer inside the product.
 * This adds the screen: the permission catalogue on the left, a checkbox per
 * key, and the roles an operator created alongside the shipped ones.
 *
 * The administrator is deliberately not editable here: the core restores its
 * full grant on every save, so a mistake on this screen can always be undone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_ROLES_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

// --- preload bridge -------------------------------------------------------
let pre = fs.readFileSync(PRELOAD, 'utf8');
if (pre.includes('roles.save')) {
  console.log('preload already applied');
} else {
  pre = replaceOnce(
    pre,
    `  users: {
    list: () => call("users.list"),`,
    `  roles: {
    /** Every permission key the core knows, grouped by what it governs. */
    catalogue: () => call("permissions.list"),
    list: () => call("roles.list"),
    /** Creates when \`id\` is absent; \`permissions\` replaces the whole set. */
    save: (role) => call("roles.save", role),
    remove: (roleId) => call("roles.delete", { roleId })
  },
  users: {
    list: () => call("users.list"),`,
    'roles bridge',
  );
  fs.writeFileSync(PRELOAD, pre);
  console.log('patched', PRELOAD);
}

// --- the screen -----------------------------------------------------------
let s = fs.readFileSync(BUNDLE, 'utf8');
// --- the panel must never be invisible -------------------------------------
// It used to `return null` whenever the bridge call failed, so a broken method
// gate (main rejecting roles.list as an unknown method) looked exactly like
// "this feature was never built". Guarded on its own so it converges whether
// or not the main patch below has already run.
{
  const silent = '  if (denied || !catalogue) return null;';
  if (s.includes(silent)) {
    s = s.replace(
      silent,
      '  if (denied) return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass mt-6 rounded-2xl p-5", children: [\n' +
      '    /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: "Rollar və səlahiyyətlər" }),\n' +
      '    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-sm text-muted", children: "Bu bölmə sizin hesabınıza açıq deyil — administratordan roles.manage səlahiyyəti istəyin." })\n' +
      '  ] });\n' +
      '  if (!catalogue) return /* @__PURE__ */ jsxRuntimeExports.jsx("section", { className: "glass mt-6 rounded-2xl p-5 text-sm text-muted", children: "Rollar yüklənir…" });',
    );
    fs.writeFileSync(BUNDLE, s);
    console.log('patched: roles panel reports why it is empty');
  }
}

if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

s = replaceOnce(
  s,
  'function AdminStaffPage() {',
  `function RolePermissionsPanel() {
  const [catalogue, setCatalogue] = reactExports.useState(null);
  const [roles, setRoles] = reactExports.useState([]);
  const [selected, setSelected] = reactExports.useState(null);
  const [draft, setDraft] = reactExports.useState([]);
  const [name, setName] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const [denied, setDenied] = reactExports.useState(false);

  const load = reactExports.useCallback(async () => {
    const [cat, list] = await Promise.all([
      window.pos.roles.catalogue(),
      window.pos.roles.list()
    ]);
    // A cashier opening this page is not an error worth shouting about; the
    // panel simply does not belong to them.
    if (!cat.success || !list.success) {
      setDenied(true);
      return;
    }
    setCatalogue(cat.data.groups ?? {});
    setRoles(list.data.roles ?? []);
  }, []);

  reactExports.useEffect(() => {
    void load();
  }, [load]);

  const open = (role) => {
    setSelected(role);
    setName(role ? role.name : "");
    setDraft(role ? [...(role.permissions ?? [])] : []);
  };

  const toggle = (key) => {
    setDraft((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const save = async () => {
    if (!name.trim()) {
      toast("Rol adı tələb olunur", "danger");
      return;
    }
    setBusy(true);
    const res = await window.pos.roles.save({
      id: selected?.id,
      name: name.trim(),
      rank: selected?.rank ?? 10,
      permissions: draft
    });
    setBusy(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast("Səlahiyyətlər saxlanıldı — işçilər növbəti girişdə tətbiq edir", "success");
    setSelected(null);
    await load();
  };

  const remove = async (role) => {
    const res = await window.pos.roles.remove(role.id);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    toast("Rol silindi", "success");
    setSelected(null);
    await load();
  };

  if (denied || !catalogue) return null;

  const admin = selected?.id === "role-administrator";

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass mt-6 rounded-2xl p-5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("h2", { className: "flex items-center gap-2 font-display text-lg text-cream", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, { className: "h-4 w-4 text-gold" }),
      "Rollar və səlahiyyətlər"
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: "Rol seçin və hər səlahiyyəti açıb-bağlayın. Dəyişiklik hər işçinin növbəti girişində qüvvəyə minir." }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 flex flex-wrap gap-2", children: [
      roles.map((role) => /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
        type: "button",
        onClick: () => open(role),
        className: selected?.id === role.id
          ? "rounded-xl border border-gold/50 bg-gold/15 px-3 py-2 text-sm text-gold"
          : "rounded-xl border border-hairline px-3 py-2 text-sm text-muted hover:text-cream",
        children: [role.name, /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ml-2 text-xs text-faint", children: ["(", role.staffCount, ")"] })]
      }, role.id)),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
        type: "button",
        onClick: () => open(null),
        className: "rounded-xl border border-dashed border-gold/40 px-3 py-2 text-sm text-gold",
        children: "+ Yeni rol"
      })
    ] }),

    selected !== null || name !== "" ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mt-4 space-y-3 rounded-xl border border-hairline p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs uppercase tracking-wide text-faint", children: "Rolun adı" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
          value: name,
          disabled: admin,
          onChange: (e) => setName(e.target.value),
          className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream outline-none focus:border-gold/40 disabled:opacity-40"
        })
      ] }),

      admin ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-gold/80", children: "Administrator həmişə bütün səlahiyyətlərə malikdir — bu, bu ekranda edilən səhvi geri qaytarmağın yeganə yoludur." }) : null,

      Object.keys(catalogue).sort().map((group) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-1", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-gold-dim", children: group }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid gap-1 sm:grid-cols-2", children: catalogue[group].map((perm) => /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-cream hover:bg-elevated/60", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
            type: "checkbox",
            disabled: admin,
            checked: admin || draft.includes(perm.key),
            onChange: () => toggle(perm.key),
            className: "mt-0.5 shrink-0"
          }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "min-w-0", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block truncate", children: perm.key }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-xs text-faint", children: perm.description })
          ] })
        ] }, perm.key)) })
      ] }, group)),

      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
          type: "button",
          disabled: busy || admin,
          onClick: () => void save(),
          className: "touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:opacity-40",
          children: busy ? "Saxlanılır…" : "Saxla"
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
          type: "button",
          onClick: () => { setSelected(null); setName(""); setDraft([]); },
          className: "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted",
          children: "Bağla"
        }),
        selected?.custom ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
          type: "button",
          onClick: () => void remove(selected),
          className: "touch-target rounded-xl border border-danger/50 px-4 py-2 text-sm text-danger",
          children: "Rolu sil"
        }) : null
      ] })
    ] }) : null
  ] });
}
function AdminStaffPage() {`,
  'roles panel component',
);

s = replaceOnce(
  s,
  `      ] })
    ] }),
    confirmDialog
  ] });
}
function AdminTablesPage() {`,
  `      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(RolePermissionsPanel, {}),
    confirmDialog
  ] });
}
function AdminTablesPage() {`,
  'roles panel mounted in the staff page',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('window.pos.roles.save'), 'save call missing');
// Every identifier the panel references must already exist in the bundle, or
// the staff page throws at render and no syntax check would have caught it.
for (const symbol of ['ShieldAlert', 'reactExports', 'jsxRuntimeExports', 'toast']) {
  must(s.split(symbol).length - 1 > 1, `${symbol} is not defined in the bundle`);
}
must(s.includes('RolePermissionsPanel'), 'panel missing');
must(s.split('RolePermissionsPanel').length - 1 >= 2, 'panel declared but not mounted');

console.log('patched', BUNDLE);
