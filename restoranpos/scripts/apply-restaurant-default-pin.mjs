#!/usr/bin/env node
/**
 * The seeded administrator PIN (9001) is public, so the core answers it with
 * E_PIN_CHANGE_REQUIRED instead of a session (AuthHandlers.cpp). The login pad
 * then asks for a new PIN twice and signs in with auth.login {pin, newPin},
 * which replaces the PIN and opens the session in one step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_DEFAULT_PIN_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let preload = fs.readFileSync(PRELOAD, 'utf8');
if (!preload.includes(MARK)) {
  preload = replaceOnce(preload,
    'login: (userId, pin) => call("auth.login", { userId: userId ?? "", pin }),',
    `login: (userId, pin, newPin) => ${MARK} call("auth.login", newPin ? { userId: userId ?? "", pin, newPin } : { userId: userId ?? "", pin }),`,
    'preload auth.login');
  fs.writeFileSync(PRELOAD, preload);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  s = replaceOnce(s,
    `  const submit = reactExports.useCallback(async () => {
    if (pin.length < 4 || busy || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setPinPhase("busy");
    setError(null);
    const res = await window.pos.auth.login(null, pin);
    if (!res.success) {
      submittingRef.current = false;
      setBusy(false);
      setPin("");
      setPinPhase("err");`,
    `  const [pinChange, setPinChange] = reactExports.useState(null); ${MARK}
  const submit = reactExports.useCallback(async () => {
    if (pin.length < 4 || busy || submittingRef.current) return;
    if (pinChange && !pinChange.first) {
      setPinChange({ old: pinChange.old, first: pin });
      setPin("");
      setPinPhase("idle");
      setError("Yeni PIN-i təkrar daxil edin");
      return;
    }
    if (pinChange && pinChange.first !== pin) {
      setPinChange({ old: pinChange.old, first: null });
      setPin("");
      setPinPhase("err");
      setError("PIN-lər uyğun gəlmir. Yeni PIN-i yenidən daxil edin");
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setPinPhase("busy");
    setError(null);
    const res = pinChange ? await window.pos.auth.login(null, pinChange.old, pin) : await window.pos.auth.login(null, pin);
    if (!res.success) {
      submittingRef.current = false;
      setBusy(false);
      setPin("");
      if (res.error.code === "E_PIN_CHANGE_REQUIRED") {
        setPinChange({ old: pin, first: null });
        setPinPhase("idle");
        setError("Standart PIN təhlükəsiz deyil. Yeni 4 rəqəmli PIN daxil edin");
        return;
      }
      if (pinChange) setPinChange(res.error.code === "E_VALIDATION" ? { old: pinChange.old, first: null } : null);
      setPinPhase("err");`,
    'login submit');
  s = replaceOnce(s,
    '  }, [selected, pin, busy, navigate, t, setSession]);',
    '  }, [selected, pin, busy, navigate, t, setSession, pinChange]);',
    'login submit deps');
  s = replaceOnce(s,
    'else if (event.key === "Escape") { setPin(""); setError(null); setPinPhase("idle"); }',
    'else if (event.key === "Escape") { setPin(""); setError(null); setPinPhase("idle"); setPinChange(null); }',
    'login escape');
  fs.writeFileSync(BUNDLE, s);
  console.log('default PIN change applied', BUNDLE);
} else {
  console.log('default PIN change already applied', BUNDLE);
}
