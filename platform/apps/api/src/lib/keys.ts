import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  generateEd25519KeyPair,
  toHex,
  fromHex,
  type Ed25519KeyPair,
} from '@milioner/security';
import { CONTROL_ROOT, env } from '../env.js';

let cached: Ed25519KeyPair | null = null;

export function loadOrCreateSigningKeys(): Ed25519KeyPair {
  if (cached) return cached;

  const privPath = env.ed25519PrivateKeyPath;
  const pubPath = env.ed25519PublicKeyPath;

  if (privPath && pubPath) {
    const privateKey = fromHex(readFileSync(privPath, 'utf8').trim());
    const publicKey = fromHex(readFileSync(pubPath, 'utf8').trim());
    cached = { privateKey, publicKey };
    return cached;
  }

  // Dev-only auto-generate into control/.data/keys
  const keysDir = path.join(CONTROL_ROOT, '.data', 'keys');
  mkdirSync(keysDir, { recursive: true });
  const privateFile = path.join(keysDir, 'ed25519.private.hex');
  const publicFile = path.join(keysDir, 'ed25519.public.hex');

  if (existsSync(privateFile) && existsSync(publicFile)) {
    cached = {
      privateKey: fromHex(readFileSync(privateFile, 'utf8').trim()),
      publicKey: fromHex(readFileSync(publicFile, 'utf8').trim()),
    };
    return cached;
  }

  const pair = generateEd25519KeyPair();
  writeFileSync(privateFile, toHex(pair.privateKey), { mode: 0o600 });
  writeFileSync(publicFile, toHex(pair.publicKey), { mode: 0o644 });
  console.warn(
    `[keys] Generated Ed25519 keypair under ${keysDir} (dev only). Set ED25519_*_PATH in production.`,
  );
  cached = pair;
  return cached;
}
