'use strict';

/**
 * Confidentiality for LAN replication.
 *
 * Signatures already prove who sent a sync document; they do not hide it, and
 * the documents carry sales, stock and prices. Each till therefore also holds an
 * X25519 key whose public half travels in its signed discovery beacon. A caller
 * generates an ephemeral X25519 key per exchange, derives two AES-256-GCM keys
 * with HKDF (one per direction) and seals the signed document; the receiver
 * opens it with its static key and answers under the response key. A passive
 * observer sees only ciphertext, and a captured exchange cannot be read later
 * even if the caller's device key leaks, because its half is ephemeral.
 */
const {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} = require('node:crypto');

const VERSION = 2;
const AAD = Buffer.from('possistem-lan-v2', 'utf8');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const HEX32 = /^[0-9a-f]{64}$/i;

function createEncryptionKey() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    encPublicKeyHex: Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex'),
    encPrivateKeyPkcs8: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' })).toString('base64'),
  };
}

function publicKeyFromHex(hex) {
  if (!HEX32.test(String(hex || ''))) throw new Error('invalid X25519 public key');
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

function privateKeyFromPkcs8(base64) {
  return createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
}

function directionKeys(shared, ephemeralHex, recipientHex) {
  const salt = Buffer.from(`${ephemeralHex}${recipientHex}`, 'hex');
  const derive = (label) => Buffer.from(hkdfSync('sha256', shared, salt, Buffer.from(`possistem-lan-v2 ${label}`, 'utf8'), 32));
  return { request: derive('request'), response: derive('response') };
}

function seal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
  return { v: VERSION, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function open(envelope, key) {
  if (!envelope || envelope.v !== VERSION) throw new Error('unsupported LAN envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(envelope.iv), 'base64'));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(String(envelope.tag), 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(String(envelope.ct), 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/** Caller side: seals `value` for the peer whose beacon announced `recipientHex`. */
function sealRequest(value, recipientHex) {
  const ephemeral = generateKeyPairSync('x25519');
  const epk = Buffer.from(ephemeral.publicKey.export({ type: 'spki', format: 'der' })).subarray(-32).toString('hex');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyFromHex(recipientHex) });
  const keys = directionKeys(shared, epk, recipientHex);
  return { envelope: { ...seal(value, keys.request), epk }, responseKey: keys.response };
}

/** Receiver side: opens a request with this till's static key. */
function openRequest(envelope, ownPrivatePkcs8, ownPublicHex) {
  const shared = diffieHellman({ privateKey: privateKeyFromPkcs8(ownPrivatePkcs8), publicKey: publicKeyFromHex(envelope?.epk) });
  const keys = directionKeys(shared, String(envelope.epk), ownPublicHex);
  return { value: open(envelope, keys.request), responseKey: keys.response };
}

module.exports = {
  VERSION,
  createEncryptionKey,
  sealRequest,
  openRequest,
  sealResponse: (value, key) => seal(value, key),
  openResponse: (envelope, key) => open(envelope, key),
};
