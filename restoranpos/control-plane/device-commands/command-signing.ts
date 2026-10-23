import { signLicensePayload } from '@milioner/security';
import { loadOrCreateSigningKeys } from './keys.js';

/** How long a till may act on a command after the server handed it out. */
export const COMMAND_TTL_MS = 15 * 60 * 1000;

/**
 * Signs a remote command (X/Z report, catalog change, ...) with the licence key
 * the tills already trust, bound to one customer and one device and valid for
 * COMMAND_TTL_MS. Tills refuse a command whose envelope does not verify, names
 * another device or customer, or has expired; the command id stops replays.
 */
export function signDeviceCommand(fields: {
  id: string;
  customerId: string;
  deviceId: string;
  command?: string;
  args?: unknown;
  kind?: string;
  payload?: unknown;
}) {
  const keys = loadOrCreateSigningKeys();
  const issuedAt = Date.now();
  return signLicensePayload(
    keys.privateKey,
    { type: 'pos-command', ...fields, issuedAt, expiresAt: issuedAt + COMMAND_TTL_MS },
    keys.publicKey,
  );
}
