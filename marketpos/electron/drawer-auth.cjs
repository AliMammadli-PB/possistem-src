'use strict';

/**
 * Opening the cash drawer.
 *
 * Identity and approval never come from the renderer: the payload is built by
 * authorizeCorePayload from the verified session (role, actorId) and, when a
 * manager PIN was typed, from main's own PIN check (approverId). The drawer is
 * driven only after the core has granted OPEN_DRAWER and logged it; any refusal
 * or core error leaves the hardware untouched.
 */
const { authorizeCorePayload } = require('./core-payload.cjs');

const REASON_MAX = 160;

/**
 * @param {object} input            { reason, managerPin } from the renderer
 * @param {object} deps
 * @param {() => ({id, role}|null)} deps.resolveUser  the verified session user, or null
 * @param {(pin: string) => ({ok, approverId})} deps.verifyManagerPin
 * @param {(method: string, payload: object) => Promise<{success: boolean, error?: object}>} deps.invokeCore
 * @param {() => Promise<unknown>} deps.openDrawer    drives the physical drawer
 */
async function openDrawerAuthorized(input, { resolveUser, verifyManagerPin, invokeCore, openDrawer }) {
  const user = resolveUser();
  if (!user) {
    const err = new Error('Sessiya bitib');
    err.code = 'E_UNAUTHENTICATED';
    throw err;
  }
  const reason = String(input?.reason || 'manual').slice(0, REASON_MAX);
  const payload = authorizeCorePayload({ reason }, () => user, verifyManagerPin, input?.managerPin);
  const result = await invokeCore('drawer.openLogged', payload);
  if (!result || result.success !== true) {
    const err = new Error(result?.error?.message || 'Buna icazəniz yoxdur');
    err.code = result?.error?.code || 'PERMISSION_DENIED';
    throw err;
  }
  return openDrawer();
}

module.exports = { openDrawerAuthorized };
