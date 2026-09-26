'use strict';

/**
 * Remote commands (X/Z reports and the like) arrive in the control plane's sync
 * response. The till acts on one only when the control plane signed it with the
 * licence key this till pinned at activation, for this customer and this
 * device, and it has not expired; the signed copy of the command is what runs,
 * and an id already acted on is refused (no replay within the TTL).
 */
const { createPublicKey, verify } = require('node:crypto');

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * @returns {{ ok: true, command: { id, kind, payload } } | { ok: false, reason: string }}
 */
function verifySignedCommand(command, { publicKeyHex, deviceId, customerId, seen, now = Date.now() }) {
  try {
    const signed = command?.signed;
    const p = signed?.payload;
    if (!publicKeyHex || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return { ok: false, reason: 'no pinned licence key' };
    if (!p || typeof p !== 'object' || !/^[0-9a-f]{128}$/i.test(String(signed.signature || ''))) return { ok: false, reason: 'unsigned' };
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(JSON.stringify(p), 'utf8'), key, Buffer.from(signed.signature, 'hex'))) return { ok: false, reason: 'bad signature' };
    if (p.type !== 'pos-command' || p.id !== command.id) return { ok: false, reason: 'not this command' };
    if (p.deviceId !== deviceId || p.customerId !== customerId) return { ok: false, reason: 'another till' };
    if (!(Number(p.expiresAt) > now) || Number(p.issuedAt) > now + CLOCK_SKEW_MS) return { ok: false, reason: 'expired' };
    if (seen?.has(p.id)) return { ok: false, reason: 'replayed' };
    seen?.add(p.id);
    return { ok: true, command: { id: p.id, kind: p.kind, payload: p.payload ?? {} } };
  } catch {
    return { ok: false, reason: 'unverifiable' };
  }
}

module.exports = { verifySignedCommand };
