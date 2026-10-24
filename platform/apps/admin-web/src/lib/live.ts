import { useEffect, useLayoutEffect, useRef, useState, type DependencyList, type EffectCallback } from 'react';

declare global {
  interface Window { __possistemDirty?: boolean; __possistemBack?: () => boolean }
}

// Field snapshots protect drafts in forms that do not have a native <form>.
// A successful save clears only the field group whose action started the request.
const dirty = new Map<Element, { value: string; group: Element | null }>();
const baseline = new WeakMap<Element, string>();
const guards = new Set<symbol>();
let inFlight = 0;
let installed = false;
let revision = 0;
const listeners = new Set<() => void>();
function value(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  return el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type) ? String(el.checked) : el.value;
}
function group(el: Element | null) { return el?.closest('form, .plans-admin-card, .product-admin-card, .pb-layout, .card') ?? null; }
function syncDirty() {
  for (const el of dirty.keys()) if (!el.isConnected) dirty.delete(el);
  window.__possistemDirty = dirty.size > 0 || guards.size > 0;
}
export function resetLiveDrafts() { dirty.clear(); syncDirty(); }
export function canRefreshLive() {
  syncDirty();
  const active = document.activeElement;
  return document.visibilityState !== 'hidden' && navigator.onLine && inFlight === 0 && !window.__possistemDirty &&
    !(active instanceof Element && active.matches('input, textarea, select, [contenteditable="true"]')) &&
    !document.querySelector('[role="dialog"], dialog[open]');
}
function notify() { if (canRefreshLive()) { revision++; listeners.forEach(fn => fn()); } }
export function beginAdminRequest(method: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return () => {};
  inFlight++;
  const source = group(document.activeElement);
  const snapshot = new Map([...dirty].filter(([, d]) => d.group === source));
  return (saved = false) => {
    inFlight = Math.max(0, inFlight - 1);
    if (saved && source) {
      for (const [el, prior] of snapshot) {
        const current = dirty.get(el);
        if (current?.value === prior.value && el instanceof HTMLElement && 'value' in el && value(el as HTMLInputElement) === prior.value) {
          baseline.set(el, prior.value); dirty.delete(el);
        }
      }
      syncDirty();
      // Give the calling component time to apply its saved response first.
      window.setTimeout(notify, 300);
    }
  };
}
export function installLiveRefresh() {
  if (installed) return;
  installed = true;
  const field = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ? target : null;
  document.addEventListener('focusin', event => { const el = field(event.target); if (el && !dirty.has(el)) baseline.set(el, value(el)); });
  const change = (event: Event) => {
    const el = field(event.target);
    if (!el || !el.closest('.main, .auth-card') || el.type === 'search' || el.closest('.filter-row, .gate-search, .mail-profile-filters')) return;
    const before = baseline.get(el);
    if (before !== undefined && value(el) === before) dirty.delete(el);
    else dirty.set(el, { value: value(el), group: group(el) });
    syncDirty();
  };
  document.addEventListener('input', change);
  document.addEventListener('change', change);
  window.addEventListener('beforeunload', event => { syncDirty(); if (window.__possistemDirty) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', notify);
  window.addEventListener('focus', notify);
  window.addEventListener('online', notify);
  window.addEventListener('possistem:foreground', notify);
  window.setInterval(notify, 15000);
}

/** Re-run read-only loaders on foreground/poll without remounting a page or replaying writes. */
export function useLiveEffect(effect: EffectCallback, deps: DependencyList) {
  const [tick, setTick] = useState(revision);
  const ref = useRef(effect); ref.current = effect;
  useEffect(() => { const update = () => setTick(revision); listeners.add(update); return () => { listeners.delete(update); }; }, []);
  useEffect(() => ref.current(), [...deps, tick]);
}

/** Explicit draft guard also covers reorder/add/remove actions without a text input. */
export function useDraftGuard(isDirty: boolean) {
  const key = useRef(Symbol('draft'));
  useLayoutEffect(() => { if (isDirty) guards.add(key.current); else guards.delete(key.current); syncDirty(); return () => { guards.delete(key.current); syncDirty(); }; }, [isDirty]);
}
