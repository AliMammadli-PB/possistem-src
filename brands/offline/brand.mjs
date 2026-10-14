/**
 * Public stand-in for the Offline brand tooling.
 *
 * The tills' build configs import this module; the real one re-skins a build
 * for another brand when VITE_BRAND=offline and lives outside this repository.
 * Here every function is the no-op the possistem build already gets, so the
 * apps typecheck and build exactly as they ship.
 */
export const isOffline = () => false;
export const rebrandText = (code) => code;
export const brandText = (code) => code;
export const recolorCss = (css) => css;
export const brandCss = (code) => code;
export const brandApp = (code) => code;
export const brandBridge = (src) => src;
export const brandMain = (src) => src;
export const brandRestaurantMain = (src) => src;
export async function brandDist() {}
/** Vite plugin: nothing to do for the possistem brand. */
export function offlineBrand() {
  return { name: 'offline-brand' };
}
