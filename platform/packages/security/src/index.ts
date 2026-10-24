import argon2 from 'argon2';
import { createHmac, randomBytes, createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { createRequire } from 'node:module';

// Ensure noble uses Node crypto for sync SHA512 when available
const require = createRequire(import.meta.url);
try {
  const nodeCrypto = require('node:crypto');
  ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
    const h = nodeCrypto.createHash('sha512');
    for (const m of msgs) h.update(m);
    return h.digest();
  };
} catch {
  // noble falls back to async sha512
}

const ARGON2_OPTS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Crockford Base32 alphabet (no I,L,O,U) */
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomBase32(byteLength = 20): string {
  // 20 bytes = 160 bits >= 128-bit requirement
  const bytes = randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }
  // Group for readability: XXXX-XXXX-...
  return output.match(/.{1,4}/g)?.join('-') ?? output;
}

export function hmacActivationKey(pepper: string, plaintextKey: string): string {
  const normalized = plaintextKey.replace(/-/g, '').toUpperCase();
  return createHmac('sha256', pepper).update(normalized, 'utf8').digest('hex');
}

export function generateActivationKeyPlaintext(): string {
  return randomBase32(20);
}

export type Ed25519KeyPair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = ed.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function signEd25519(privateKey: Uint8Array, message: Uint8Array | string): Uint8Array {
  const msg = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  return ed.sign(msg, privateKey);
}

export function verifyEd25519(
  publicKey: Uint8Array,
  message: Uint8Array | string,
  signature: Uint8Array,
): boolean {
  const msg = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  return ed.verify(signature, msg, publicKey);
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Stable identifier for a signing key, derived from the raw 32-byte public key.
 * Clients recompute this from `publicKeyHex` to detect key rotation.
 */
export function deriveKeyId(publicKey: Uint8Array): string {
  return `ed25519-${createHash('sha256').update(Buffer.from(publicKey)).digest('hex').slice(0, 16)}`;
}

export function signLicensePayload(
  privateKey: Uint8Array,
  payload: Record<string, unknown>,
  publicKey?: Uint8Array,
): { payload: Record<string, unknown>; signature: string; signedAt: string; keyId?: string } {
  const signedAt = new Date().toISOString();
  const body = { ...payload, signedAt };
  // keyId stays outside `canonical` — verifiers sign/verify the payload alone.
  const canonical = JSON.stringify(body);
  const signature = toHex(signEd25519(privateKey, canonical));
  const envelope: { payload: Record<string, unknown>; signature: string; signedAt: string; keyId?: string } = {
    payload: body,
    signature,
    signedAt,
  };
  if (publicKey) envelope.keyId = deriveKeyId(publicKey);
  return envelope;
}

export function verifyLicensePayload(
  publicKey: Uint8Array,
  payload: Record<string, unknown>,
  signatureHex: string,
): boolean {
  const canonical = JSON.stringify(payload);
  return verifyEd25519(publicKey, canonical, fromHex(signatureHex));
}
