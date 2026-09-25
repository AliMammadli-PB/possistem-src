#!/usr/bin/env node
/**
 * Telling the till which printer is the kitchen, which is the till, which is
 * the store room.
 *
 * A restaurant with three Xprinters cabled to the switch had no way to say so.
 * The core knew two roles - `printer.receipt` and `printer.kitchen` - and the
 * settings screen wrote only the first: every call was `setPrinter("receipt",
 * …)`, so the kitchen printer could not be chosen at all, let alone a third.
 * Everything that was not a kitchen ticket printed at the till.
 *
 * The core now has three roles and a document for the third. This is the half
 * the operator uses, and it follows what they actually do when standing in the
 * room: press Test on a row, walk and see which machine produced paper, then
 * press the role on that same row. No list of device paths to decipher - the
 * identification is done by the paper, which is the only thing that cannot lie.
 *
 * Built into the existing row rather than as a wizard: the row already carries
 * the printer's name and its Test button, and a separate assignment screen
 * would make the operator match rows across two places.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_PRINTER_ROLES_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const hits = src.split(find).length - 1;
  must(hits === 1, `${label}: expected 1 match, found ${hits}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

for (const helper of ['function printerLabel(', 'function toast(', 'window.pos.print.setPrinter']) {
  must(s.includes(helper), `${helper} is not in the bundle`);
}

// --- what each role currently points at -----------------------------------
s = replaceOnce(
  s,
  '  const [printerTarget, setPrinterTarget] = reactExports.useState("auto");',
  `  const [printerTarget, setPrinterTarget] = reactExports.useState("auto");
  // One entry per role. "auto" means nothing has been assigned, which is what
  // a fresh till looks like and has to be distinguishable from a real choice.
  const [roleTargets, setRoleTargets] = reactExports.useState({ receipt: "auto", kitchen: "auto", warehouse: "auto" });
  const [assigningRole, setAssigningRole] = reactExports.useState("");`,
  'role state',
);

// --- read them back on load -----------------------------------------------
s = replaceOnce(
  s,
  `      if (data.receipt) {
        setPrinterTarget(data.receipt);
        setSelectedTarget(data.receipt);
        setManualTarget(data.receipt === "auto" ? "" : data.receipt);
      }`,
  `      if (data.receipt) {
        setPrinterTarget(data.receipt);
        setSelectedTarget(data.receipt);
        setManualTarget(data.receipt === "auto" ? "" : data.receipt);
      }
      setRoleTargets({
        receipt: data.receipt ?? "auto",
        kitchen: data.kitchen ?? "auto",
        warehouse: data.warehouse ?? "auto"
      });`,
  'role load',
);

// --- assigning one ---------------------------------------------------------
s = replaceOnce(
  s,
  '  const savePrinterProfile = async (patch) => {',
  `  // The roles, in the order an operator meets them: the till in front of
  // them, the kitchen they send tickets to, the store room they receive into.
  const PRINTER_ROLES = [
    { id: "receipt", label: "Kassa" },
    { id: "kitchen", label: "Mətbəx" },
    { id: "warehouse", label: "Anbar" }
  ];
  const assignPrinterRole = async (role, target) => {
    if (!target) { toast(t.settings.printerTargetInvalid, "danger"); return; }
    setAssigningRole(role + ":" + target);
    const res = await window.pos.print.setPrinter(role, target);
    setAssigningRole("");
    if (!res.success) { toast(res.error.message, "danger"); return; }
    setRoleTargets((prev) => ({ ...prev, [role]: target }));
    // The till's own printer is the one the rest of this screen edits, so the
    // existing selection follows it rather than silently disagreeing.
    if (role === "receipt") { setPrinterTarget(target); setSelectedTarget(target); }
    const label = PRINTER_ROLES.find((r) => r.id === role)?.label ?? role;
    toast(label + " printeri yadda saxlanıldı", "success");
  };

  const savePrinterProfile = async (patch) => {`,
  'assign function',
);

// --- the chips, on the row that has the Test button -----------------------
const testButton = `                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    disabled: testingPrint,
                    onClick: () => void runTestPrint(printer.name),
                    className: "touch-target shrink-0 rounded-xl border border-gold/40 px-3 py-2 text-xs text-gold hover:bg-gold/10 disabled:opacity-40",
                    children: t.settings.testPrint
                  }
                )`;

s = replaceOnce(
  s,
  testButton,
  `${testButton},
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex shrink-0 gap-1.5", children: PRINTER_ROLES.map((role) => {
                  const holds = roleTargets[role.id] === printer.name;
                  const busy = assigningRole === role.id + ":" + printer.name;
                  return /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      disabled: busy,
                      title: role.label + " printeri olaraq yadda saxla",
                      onClick: () => void assignPrinterRole(role.id, printer.name),
                      className: \`touch-target rounded-xl border px-2.5 py-2 text-xs disabled:opacity-40 \${holds ? "border-success/60 bg-success/15 text-success" : "border-hairline text-muted hover:border-gold/40 hover:text-cream"}\`,
                      children: busy ? "…" : (holds ? role.label + " ✓" : role.label)
                    },
                    role.id
                  );
                }) })`,
  'role chips',
);

// The row now carries three more controls, so it has to be allowed to wrap
// rather than squeezing the printer's name to nothing on a narrow screen.
s = replaceOnce(
  s,
  '              className: `flex items-center gap-3 rounded-xl border px-4 py-3 ${active ? "border-gold/50 bg-gold/10" : "border-hairline bg-elevated hover:border-gold/30"}`,',
  '              className: `flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${active ? "border-gold/50 bg-gold/10" : "border-hairline bg-elevated hover:border-gold/30"}`,',
  'row wrapping',
);

// --- say how it is done ----------------------------------------------------
// Without this the three chips read as a filter. The instruction is the
// feature: identify by paper, then label.
s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: t.settings.printerCandidates }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: "Hansı printer haradadır" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-sm text-muted", children: "Sətirdəki «Test çap» düyməsini basın, kağız hansı printerdən çıxdısa, həmin sətirdə Kassa, Mətbəx və ya Anbar seçin. Seçim dərhal yadda saxlanılır." }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-3 grid gap-2 sm:grid-cols-3", children: PRINTER_ROLES.map((role) => {
            const target = roleTargets[role.id];
            const known = target && target !== "auto";
            const printer = detectedPrinters.find((p) => p.name === target);
            return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl border border-hairline px-3 py-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[11px] uppercase tracking-wide text-faint", children: role.label }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: \`mt-1 truncate text-sm \${known ? "text-cream" : "text-warning"}\`, children: known ? (printer ? printerLabel(printer) : target) : "Seçilməyib" })
            ] }, role.id);
          }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: t.settings.printerCandidates }),`,
  'role summary',
);

must(s.includes('const assignPrinterRole'), 'assign function missing');
must(s.includes('PRINTER_ROLES.map'), 'chips missing');
must(s.includes('warehouse: data.warehouse ?? "auto"'), 'warehouse not read back');
// Every role the chips offer has to be one the core accepts, or the press is a
// rejected write with nothing on screen to explain it.
for (const role of ['receipt', 'kitchen', 'warehouse']) {
  must(s.includes(`id: "${role}"`), `${role} is not offered`);
}

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
