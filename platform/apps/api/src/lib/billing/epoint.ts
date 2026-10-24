import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BillingError } from './domain.js';

export type EpointResponse = Record<string, unknown> & { status?: string; transaction?: string; redirect_url?: string; card_id?: string; amount?: string | number };
export type EpointConfig = { publicKey: string; privateKey: string; tokenKey: Buffer; baseUrl: string; origin: string; liveVerified: boolean };
export function epointConfig(): EpointConfig | null {
  const publicKey = process.env.EPOINT_PUBLIC_KEY?.trim();
  const privateKey = process.env.EPOINT_PRIVATE_KEY?.trim();
  const keyHex = process.env.EPOINT_TOKEN_ENCRYPTION_KEY?.trim();
  if (!publicKey || !privateKey || !keyHex || !/^[a-f0-9]{64}$/i.test(keyHex)) return null;
  return { publicKey, privateKey, tokenKey: Buffer.from(keyHex, 'hex'), baseUrl: 'https://epoint.az/api/1/', origin: 'https://possistem.az', liveVerified: process.env.EPOINT_LIVE_VERIFIED === 'true' };
}
export function sign(data: string, privateKey: string): string {
  return createHash('sha1').update(privateKey + data + privateKey, 'utf8').digest('base64');
}
export function verifyCallback(data: unknown, signature: unknown, key: string): EpointResponse {
  if (typeof data !== 'string' || typeof signature !== 'string' || data.length > 65536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new BillingError('invalid_callback', 'Callback düzgün deyil.', 400);
  const expected = Buffer.from(sign(data, key), 'utf8'), actual = Buffer.from(signature, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BillingError('invalid_signature', 'İmza düzgün deyil.', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8')); } catch { throw new BillingError('invalid_callback', 'Callback düzgün deyil.', 400); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BillingError('invalid_callback', 'Callback düzgün deyil.', 400);
  return parsed as EpointResponse;
}
export function encryptCard(cardId: string, key: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(cardId, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
}
export function decryptCard(value: string, key: Buffer): string {
  const [iv, tag, encrypted] = value.split('.').map(x => Buffer.from(x, 'base64'));
  if (!iv || !tag || !encrypted) throw new BillingError('invalid_card', 'Kartı yenidən qoşun.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
export class GatewayUncertain extends Error {}
export class Epoint {
  constructor(readonly config: EpointConfig, private transport: typeof fetch = fetch) {}
  async call(endpoint: 'request' | 'card-registration-with-pay' | 'execute-pay' | 'get-status' | 'reverse', payload: Record<string, unknown>): Promise<EpointResponse> {
    const data = Buffer.from(JSON.stringify({ ...payload, public_key: this.config.publicKey }), 'utf8').toString('base64');
    try {
      const response = await this.transport(this.config.baseUrl + endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data, signature: sign(data, this.config.privateKey) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new GatewayUncertain('Epoint cavabı dəqiqləşdirilir.');
      const json: unknown = await response.json();
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new GatewayUncertain('Epoint cavabı dəqiqləşdirilir.');
      return json as EpointResponse;
    } catch { throw new GatewayUncertain('Epoint cavabı dəqiqləşdirilir. Təkrar ödəniş etməyin.'); }
  }
}

// Whitelist storage fields. Never persist raw gateway responses or card data.
export function safeGatewayResponse(value: EpointResponse): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['status','code','message','transaction','operation_code','rrn','amount','trace_id']) if (typeof value[key] === 'string' || typeof value[key] === 'number') out[key] = String(value[key]).slice(0, 1000);
  const mask = String(value.card_mask || '');
  if (/^\d{4,6}\*{4,10}\d{4}$/.test(mask)) out.card_mask = mask;
  return out;
}
