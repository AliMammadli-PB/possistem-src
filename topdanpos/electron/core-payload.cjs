'use strict';

/**
 * Decides who the core thinks is calling.
 *
 * The core reads `role` straight out of the request payload to answer
 * "may this person refund?", and the renderer used to supply that payload
 * unchanged — so any code running in the window could call
 * `invoke('return.partial', { role: 'manager' })` and the manager PIN dialog was
 * decoration. `approverId` was worse: the core accepted *any* non-empty string
 * as a manager's blessing.
 *
 * Both fields are now stripped from whatever the renderer sent and written from
 * the session token main already verified. Unauthenticated calls get neither,
 * which the core treats as "no role" and refuses.
 */

/**
 * Fields the renderer must never be able to set.
 *
 * `policySource` is here for a different reason than the other three: it is not
 * an identity claim but the core's only proof that `roles.applyPolicy` came
 * from the control plane rather than from a window script. Stripping it is what
 * stops any code in the renderer from rewriting every grant in the shop.
 */
const ASSERTED = ['role', 'actorId', 'approverId', 'policySource'];

/**
 * @param rawPayload what the renderer sent
 * @param resolveSession () => ({ id, role }) for a verified session, or null
 * @param verifyManagerPin (pin) => ({ ok, approverId }) — the only thing that
 *   may produce an approverId, since the core reads that as manager approval
 * @param managerPin what the operator typed into the override dialog, if any
 */
function authorizeCorePayload(rawPayload, resolveSession, verifyManagerPin, managerPin) {
  const payload =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? { ...rawPayload }
      : {};

  for (const field of ASSERTED) delete payload[field];

  const user = resolveSession();
  if (!user) return payload; // fail closed: the core sees no role at all

  payload.role = String(user.role || '');
  payload.actorId = String(user.id || '');

  if (managerPin && typeof verifyManagerPin === 'function') {
    const approval = verifyManagerPin(managerPin);
    if (approval && approval.ok) payload.approverId = String(approval.approverId || '');
  }
  return payload;
}

module.exports = { authorizeCorePayload, ASSERTED };
