#!/usr/bin/env node
/**
 * Pick the role when you add someone.
 *
 * The form hardcoded `role: "waiter"`, so every person created on this screen
 * became a waiter no matter what they actually do - the roles screen right
 * below it could define a cashier or a storekeeper, and there was no way to put
 * anybody in one. The list is read from the core, so a role created on that
 * panel shows up here without another release.
 *
 * `administrator` is filtered out: the core refuses to create one
 * (`users.create` throws on that name), so offering it would be a choice that
 * always fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_STAFF_ROLE_v1 */';

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
  process.exit(0);
}

// --- state: the chosen role, and the roles to choose from -----------------
s = replaceOnce(
  s,
  `  const [pin, setPin] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const load = reactExports.useCallback(async () => {
    const res = await window.pos.users.list();`,
  `  const [pin, setPin] = reactExports.useState("");
  const [role, setRole] = reactExports.useState("waiter");
  const [roles, setRoles] = reactExports.useState([]);
  const [busy, setBusy] = reactExports.useState(false);
  reactExports.useEffect(() => {
    // Only an operator with roles.manage can read the list. For everyone else
    // the select falls back to the shipped roles rather than showing nothing -
    // assigning a role is part of adding staff, not part of editing roles.
    void window.pos.roles.list().then((res) => {
      if (!res.success) return;
      const named = (res.data.roles ?? [])
        .map((r) => r.name)
        .filter((name) => name && name !== "administrator");
      if (named.length) setRoles(named);
    });
  }, []);
  const load = reactExports.useCallback(async () => {
    const res = await window.pos.users.list();`,
  'staff role state',
);

// --- use it ---------------------------------------------------------------
s = replaceOnce(
  s,
  `      { fullName: fullName.trim(), pin, role: "waiter" },`,
  `      { fullName: fullName.trim(), pin, role },`,
  'create uses the chosen role',
);

s = replaceOnce(
  s,
  `    setFullName("");
    setPin("");
    await load();
  };
  const deactivate = async (user) => {`,
  `    setFullName("");
    setPin("");
    setRole("waiter");
    await load();
  };
  const deactivate = async (user) => {`,
  'reset after create',
);

// --- the control, between PIN and the save button -------------------------
const anchor = `            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "submit",
                disabled: busy || fullName.trim().length < 2 || pin.length < 4,`;
must(s.split(anchor).length - 1 === 1, 'submit button anchor not unique');
s = s.replace(
  anchor,
  `            /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "mt-3 block text-sm", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Vəzifə" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "select",
                {
                  value: role,
                  onChange: (e) => setRole(e.target.value),
                  className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50",
                  children: (roles.length ? roles : ["waiter", "cashier", "kitchen", "storekeeper", "supervisor", "manager"]).map(
                    (name) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: name, children: _psRoleAz(name) }, name)
                  )
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mt-1 block text-xs text-faint", children: "Vəzifənin nə edə biləcəyi aşağıdakı «Rollar və səlahiyyətlər» bölməsində təyin olunur." })
            ] }),
` + anchor,
);

// --- Azerbaijani names for the shipped roles, display only ----------------
// The stored name is the wire value: `users.create` resolves a role BY NAME and
// refuses the literal "administrator", so translating the data would break
// staff creation. Only the label changes.
s = replaceOnce(
  s,
  'function AdminStaffPage() {',
  `const _PS_ROLE_AZ = {
  waiter: "Ofisiant",
  cashier: "Kassir",
  kitchen: "Mətbəx",
  storekeeper: "Anbarçı",
  supervisor: "Növbə rəhbəri",
  manager: "Müdir",
  administrator: "Administrator",
  courier: "Kuryer"
};
function _psRoleAz(name) {
  return _PS_ROLE_AZ[name] || name;
}

function AdminStaffPage() {`,
  'role label map',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('const [role, setRole]'), 'role state missing');
must(s.includes('{ fullName: fullName.trim(), pin, role }'), 'create still hardcodes a role');
must(!s.includes('pin, role: "waiter" }'), 'hardcoded waiter survived');
must(s.includes('_psRoleAz(name)'), 'role labels missing');
must(s.includes('"Anbarçı"'), 'storekeeper label missing');
// The core refuses to create one, so it must never be offered.
must(
  !s.includes('["waiter", "cashier", "kitchen", "storekeeper", "supervisor", "manager", "administrator"]'),
  'administrator offered in the fallback list',
);

console.log('patched', BUNDLE);
