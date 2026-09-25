#!/usr/bin/env node
/**
 * Printer setup as three short questions instead of one crowded panel.
 *
 * What the panel had grown into: an auto-detect card, a role picker, a
 * three-box summary, a device list where every row carried a test button, a
 * "here" button and up to three role labels, then a checkbox and a collapsible
 * manual field - all on screen at once, all of it relevant only while a printer
 * is being set up, which happens about twice in the life of a restaurant.
 *
 * What it is now: three lines, one per printer, each saying what it points at
 * and offering one button. Pressing it opens a short wizard for that printer
 * and nothing else:
 *
 *   Printeri tap  ->  a page goes to the first candidate
 *                 ->  "did paper come out of the kitchen printer?"
 *                 ->  yes: saved.  no: try the next one.
 *   Əl ilə yaz    ->  type an address, test it, save it.
 *
 * The manual path is not a fallback hidden behind a "+": a network printer with
 * a known IP is the normal case in a wired restaurant, and it was previously
 * only able to write the till's role no matter which printer was being set up.
 *
 * Everything below the picker - the auto-search checkbox, paper width, QR,
 * geometry, receipt preview - is untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_PRINTER_SETUP_v1 */';

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

// Built on what the earlier layers introduced. Naming them means a layer that
// stops running fails here rather than leaving markup that refers to nothing.
for (const symbol of ['const PRINTER_ROLES', 'const assignPrinterRole', 'const [roleTargets,',
                      'function printerLabel(', 'const runTestPrint']) {
  must(s.includes(symbol), `${symbol} is missing — the earlier printer layers must run first`);
}

// --- the wizard's own state ------------------------------------------------
s = replaceOnce(
  s,
  '  const [setupRole, setSetupRole] = reactExports.useState("receipt");',
  `  const [setupRole, setSetupRole] = reactExports.useState("");
  // The candidate walk: the list as found, which one is being asked about, and
  // whether the operator is typing an address instead.
  const [wizardList, setWizardList] = reactExports.useState([]);
  const [wizardAt, setWizardAt] = reactExports.useState(-1);
  const [wizardBusy, setWizardBusy] = reactExports.useState(false);
  const [wizardManual, setWizardManual] = reactExports.useState(false);
  const [wizardAddress, setWizardAddress] = reactExports.useState("");
  const [wizardNote, setWizardNote] = reactExports.useState("");`,
  'wizard state',
);

// --- the walk --------------------------------------------------------------
s = replaceOnce(
  s,
  '  const savePrinterProfile = async (patch) => {',
  `  const closeWizard = () => {
    setSetupRole(""); setWizardList([]); setWizardAt(-1);
    setWizardManual(false); setWizardAddress(""); setWizardNote("");
  };

  const openWizard = (role) => {
    setSetupRole(role); setWizardList([]); setWizardAt(-1);
    setWizardManual(false); setWizardNote("");
    // Prefill with whatever this role already points at, so "change the IP"
    // does not mean retyping it.
    const current = roleTargets[role];
    setWizardAddress(current && current !== "auto" ? current : "");
  };

  /** Sends the test page to one candidate and waits for the operator's answer. */
  const wizardProbe = async (list, index) => {
    if (index >= list.length) {
      setWizardAt(list.length);
      setWizardNote("Bütün cihazlar yoxlanıldı. Printer şəbəkədədirsə, ünvanı əl ilə yazın.");
      return;
    }
    setWizardAt(index);
    setWizardNote("");
    setWizardBusy(true);
    await runTestPrint(list[index].name);
    setWizardBusy(false);
  };

  const wizardFind = async () => {
    setWizardBusy(true);
    setWizardNote("");
    // probe:false — the core's own probing picks a winner and saves it, which
    // is the opposite of what this screen is for: here the operator decides,
    // by looking at the paper.
    const res = await window.pos.print.detect({ probe: false });
    setWizardBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return; }
    const found = (res.data.candidates ?? []).filter((p) => p.connection !== "virtual");
    setDetectedPrinters(res.data.candidates ?? []);
    setWizardList(found);
    if (found.length === 0) {
      setWizardAt(0);
      setWizardNote("Heç bir printer tapılmadı. Kabeli yoxlayın və ya ünvanı əl ilə yazın.");
      return;
    }
    await wizardProbe(found, 0);
  };

  const wizardKeep = async (target) => {
    await assignPrinterRole(setupRole, target);
    closeWizard();
  };

  const wizardManualTest = async () => {
    const target = wizardAddress.trim();
    if (!target) { toast(t.settings.printerTargetInvalid, "danger"); return; }
    setWizardBusy(true);
    await runTestPrint(target);
    setWizardBusy(false);
  };

  const savePrinterProfile = async (patch) => {`,
  'wizard actions',
);

// --- the panel itself ------------------------------------------------------
const picker = fs.readFileSync(path.join(ROOT, 'scripts/printer-setup-markup.txt'), 'utf8').trim();
const oldSpan = fs.readFileSync(path.join(ROOT, 'scripts/printer-setup-old-span.txt'), 'utf8');
must(oldSpan.length > 4000, 'the captured span looks too small to be the picker');
s = replaceOnce(s, oldSpan, picker + '\n', 'device picker');

must(s.includes('const wizardFind'), 'the search action is missing');
must(s.includes('Əl ilə yaz'), 'the manual path is missing');
must(!s.includes('children: "Bura"'), 'the old per-row button survived');
must(!s.includes('t.settings.printerCandidates'), 'the old device list survived');
// Each role still has to be reachable, or a printer becomes unassignable.
for (const role of ['receipt', 'kitchen', 'warehouse']) {
  must(s.includes(`id: "${role}"`), `${role} is not offered`);
}

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
