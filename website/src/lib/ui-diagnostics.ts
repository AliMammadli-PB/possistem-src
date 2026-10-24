export const UI_REVISION = '20261023-mascot-rest-placement-1';
export const UI_DIAGNOSTIC_EVENT = 'possistem:ui-diagnostics';
type SafeValue = string | number | boolean | null | string[];
const state: Record<string, Record<string, SafeValue>> = {};
export function uiDebugEnabled() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ui-debug') === '1';
}
/** Call sites pass only fixed state labels, local asset IDs and numeric measurements. */
export function reportUiState(section: 'slider' | 'mascot' | 'theme', value: Record<string, SafeValue>) {
  if (!uiDebugEnabled()) return;
  state[section] = value;
  window.dispatchEvent(new Event(UI_DIAGNOSTIC_EVENT));
}
export function readUiState() { return { revision: UI_REVISION, ...state }; }
