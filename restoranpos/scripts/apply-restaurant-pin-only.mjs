#!/usr/bin/env node
/**
 * Staff gate is PIN-only: no roster, no "pick Admin then type PIN".
 * The PIN identifies the user (core/main resolves empty userId).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_PIN_ONLY_v1 */';
const CSS_MARK = '/* POS_PIN_ONLY_v1 */';

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
    '  const [loadingUsers, setLoadingUsers] = reactExports.useState(true);\n  const [selected, setSelected] = reactExports.useState(null);',
    '  const [loadingUsers, setLoadingUsers] = reactExports.useState(false);\n  const [selected, setSelected] = reactExports.useState({ id: "", fullName: "", role: "" });',
    'skip roster load',
  );
  s = replaceOnce(
    s,
    '    if (!selected || pin.length < 4 || busy || submittingRef.current) return;',
    '    if (pin.length < 4 || busy || submittingRef.current) return;',
    'submit without selected',
  );
  s = replaceOnce(
    s,
    '    const res = await window.pos.auth.login(selected.id, pin);',
    '    const res = await window.pos.auth.login(null, pin);',
    'login by PIN only',
  );
  s = replaceOnce(
    s,
    '    if (selected && pin.length === 4) void submit();\n  }, [pin, selected, submit]);',
    '    if (pin.length === 4) void submit();\n  }, [pin, submit]);',
    'autosubmit PIN',
  );
  s = replaceOnce(
    s,
    '      if (!selected || busy) return;',
    '      if (busy) return;',
    'keyboard without selected',
  );
  s = replaceOnce(
    s,
    '      else if (event.key === "Escape") resetSelection();',
    '      else if (event.key === "Escape") { setPin(""); setError(null); setPinPhase("idle"); }',
    'escape clears PIN',
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
.ps-staff-identity,
.ps-staff-switch,
.ps-staff-identity-card,
.ps-staff-employee-status { display: none !important; }
`;
  fs.writeFileSync(CSS, css);
  console.log('patched', CSS);
}
