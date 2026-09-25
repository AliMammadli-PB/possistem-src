#!/usr/bin/env node
/**
 * The printer setup in the order the operator actually works in.
 *
 * The first version put three role buttons on every row: test a row, then press
 * Kassa or Mətbəx or Anbar on that same row. It worked, but it asks the
 * operator to hold the whole grid in their head - with three printers and three
 * roles that is nine buttons, and the question "which one am I setting up right
 * now" has no answer on screen.
 *
 * This is the order the owner described, and it is the order somebody standing
 * in a restaurant with a box of cables works in: say which printer you are
 * setting up, find the devices, test one, and if paper came out of the right
 * machine, keep it. One decision at a time, and the row you press is the row
 * you just watched.
 *
 * Three other things the screenshot showed, fixed here:
 *
 *  - The section was still titled "Kassə printeri" while configuring three.
 *  - Auto-detect always saved to the till, whichever role was being set up, so
 *    using it while setting up the kitchen silently moved the till's printer.
 *  - A virtual printer could be assigned with no warning. It accepts every job
 *    and writes it to a file, so the screen says "printed" and no paper exists
 *    - which is the single worst way for a till to fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_PRINTER_ROLES_v2 */';

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

// This layer rearranges what v1 introduced. Asserting the pieces by name means
// a v1 that stops running fails here loudly instead of leaving the screen
// referring to things that are no longer declared.
for (const symbol of ['const PRINTER_ROLES', 'const assignPrinterRole', 'const [roleTargets,']) {
  must(s.includes(symbol), `${symbol} is missing — apply-restaurant-printer-roles.mjs must run first`);
}

// --- which role is being set up right now ---------------------------------
s = replaceOnce(
  s,
  '  const [assigningRole, setAssigningRole] = reactExports.useState("");',
  `  const [assigningRole, setAssigningRole] = reactExports.useState("");
  // The role the operator is configuring. Everything below reads it: the
  // search, the test page, and the one button on each row.
  const [setupRole, setSetupRole] = reactExports.useState("receipt");`,
  'setup role state',
);

// --- the role picker, above the list --------------------------------------
s = replaceOnce(
  s,
  `          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: "Hansı printer haradadır" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-sm text-muted", children: "Sətirdəki «Test çap» düyməsini basın, kağız hansı printerdən çıxdısa, həmin sətirdə Kassa, Mətbəx və ya Anbar seçin. Seçim dərhal yadda saxlanılır." }),`,
  `          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-faint", children: "1. Hansı printeri qurursunuz" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: PRINTER_ROLES.map((role) => {
            const on = setupRole === role.id;
            return /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                onClick: () => setSetupRole(role.id),
                "aria-pressed": on,
                className: \`touch-target rounded-xl border px-4 py-2.5 text-sm \${on ? "border-gold/60 bg-gold/15 text-gold" : "border-hairline bg-elevated text-muted hover:border-gold/30"}\`,
                children: [role.label, roleTargets[role.id] && roleTargets[role.id] !== "auto" ? " ✓" : ""]
              },
              role.id
            );
          }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 text-sm text-muted", children: "2. Aşağıdan «Siyahını yenilə» deyin, sonra bir sətirdə «Test çap» basın. 3. Kağız hansı printerdən çıxdısa, həmin sətirdə «Bura» düyməsini basın — seçilmiş rol həmin printerə yazılır." }),`,
  'role picker',
);

// --- one button per row, bound to the chosen role -------------------------
const chips = `                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex shrink-0 gap-1.5", children: PRINTER_ROLES.map((role) => {
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
                }) })`;

s = replaceOnce(
  s,
  chips,
  `                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex shrink-0 items-center gap-2", children: [
                  // What this printer already answers for. Shown as a label
                  // rather than a control: it is the answer, not the question.
                  PRINTER_ROLES.filter((role) => roleTargets[role.id] === printer.name).map((role) =>
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rounded-lg border border-success/50 bg-success/10 px-2 py-1 text-xs text-success", children: role.label }, role.id)
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      disabled: assigningRole !== "" || roleTargets[setupRole] === printer.name,
                      title: (PRINTER_ROLES.find((r) => r.id === setupRole)?.label ?? "") + " printeri olaraq yadda saxla",
                      onClick: () => void assignPrinterRole(setupRole, printer.name),
                      className: "touch-target rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold hover:bg-gold/20 disabled:opacity-30",
                      children: assigningRole === setupRole + ":" + printer.name ? "…" : "Bura"
                    }
                  )
                ] })`,
  'row action',
);

// --- the test page goes to the row you pressed, for the role you picked ---
// Auto-detect used to write the till's printer whatever was being set up, so
// configuring the kitchen quietly moved the till.
s = replaceOnce(
  s,
  '    const res = await window.pos.print.detect({ probe: true }, { timeoutMs: 6e4 });',
  '    const res = await window.pos.print.detect({ probe: true, target: setupRole }, { timeoutMs: 6e4 });',
  'auto-detect target',
);
s = replaceOnce(
  s,
  `    setPrinterTarget(data.chosen);
    setSelectedTarget(data.chosen);
    setManualTarget(data.chosen);`,
  `    setRoleTargets((prev) => ({ ...prev, [setupRole]: data.chosen }));
    if (setupRole === "receipt") {
      setPrinterTarget(data.chosen);
      setSelectedTarget(data.chosen);
      setManualTarget(data.chosen);
    }`,
  'auto-detect result',
);

// --- a printer that swallows paper should say so --------------------------
s = replaceOnce(
  s,
  `    setRoleTargets((prev) => ({ ...prev, [role]: target }));`,
  `    setRoleTargets((prev) => ({ ...prev, [role]: target }));
    // A virtual printer accepts every job and writes it to a file. The screen
    // then says "printed" and no paper exists, which is the one failure a till
    // must never have quietly.
    if (/^virtual\\b/i.test(target)) {
      toast("Diqqət: bu virtual printerdir, kağız çıxarmır — yalnız fayla yazır", "warning");
    }`,
  'virtual warning',
);

// --- the section is no longer only about the till -------------------------
s = replaceOnce(
  s,
  'printer: "Kassə printeri",',
  'printer: "Printerlər",',
  'section title',
);
s = replaceOnce(
  s,
  'printerHint: "Ödənişdən sonra çek avtomatik ESC/POS ilə çap olunur",',
  'printerHint: "Kassa, mətbəx və anbar printerlərini burada təyin edin",',
  'section hint',
);
s = replaceOnce(
  s,
  'printerAutoHint: "Çek aparatını USB-yə qoşub bu düyməni basın — modelini bilmək lazım deyil. Tapılan hər cihaza qısa yoxlama vərəqi göndərilir, kağız çıxan cihaz seçilir.",',
  'printerAutoHint: "Tapılan hər cihaza qısa yoxlama vərəqi göndərilir; kağız çıxan cihaz yuxarıda seçdiyiniz rola yazılır. Bir neçə printer varsa, hər rolu ayrıca qurun.",',
  'auto hint',
);

must(s.includes('const [setupRole, setSetupRole]'), 'the role being set up is not tracked');
must(s.includes('children: assigningRole === setupRole + ":" + printer.name ? "…" : "Bura"'), 'the row action is missing');
must(s.includes('probe: true, target: setupRole'), 'auto-detect ignores the chosen role');
must(!s.includes('title: role.label + " printeri olaraq yadda saxla"'), 'the old chips survived');
must(s.includes('virtual printerdir'), 'the virtual-printer warning is missing');

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
