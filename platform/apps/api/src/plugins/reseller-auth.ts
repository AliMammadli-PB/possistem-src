import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateSessionToken } from '@milioner/security';
import { env } from '../env.js';

/**
 * Bayi oturumu — kasten HMAC'li Bearer token, çerez DEĞİL.
 *
 * Super admin route'ları `req.cookies[env.cookieName]` üzerinden `req.user`'a
 * bakar; bayi hiçbir zaman `users` satırına sahip olmaz ve çerez almaz, dolayısıyla
 * bayi kimliğiyle super admin uçlarına erişmek teknik olarak mümkün değildir.
 * Token proses yeniden başlasa da geçerli kalır (deploy sırasında oturum düşmez).
 */

const RESELLER_TTL_MS = 12 * 3600_000;

type SignedPayload = {
  resellerId: string;
  slug: string;
  email: string;
  exp: number;
  jti: string;
};

export type ResellerSession = {
  resellerId: string;
  slug: string;
  email: string;
};

/** Logout ile iptal edilen jti'ler (proses ömrü boyunca). */
const revoked = new Set<string>();

export function signResellerToken(input: {
  resellerId: string;
  slug: string;
  email: string;
}): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + RESELLER_TTL_MS;
  const payload: SignedPayload = {
    resellerId: input.resellerId,
    slug: input.slug,
    email: input.email,
    exp: expiresAt,
    jti: generateSessionToken(),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  return { token: `r1.${body}.${sig}`, expiresAt };
}

export function resolveResellerToken(raw: string | undefined): ResellerSession | null {
  if (!raw || !raw.startsWith('r1.')) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const body = parts[1]!;
  const sig = parts[2]!;

  const expect = createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    if (!payload?.resellerId || !payload.exp || payload.exp <= Date.now()) return null;
    if (payload.jti && revoked.has(payload.jti)) return null;
    return { resellerId: payload.resellerId, slug: payload.slug, email: payload.email };
  } catch {
    return null;
  }
}

export function revokeResellerToken(raw: string | undefined): void {
  if (!raw || !raw.startsWith('r1.')) return;
  try {
    const body = raw.split('.')[1]!;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    if (payload.jti) revoked.add(payload.jti);
  } catch {
    /* ignore */
  }
}

export function bearerToken(req: { headers: Record<string, unknown> }): string | undefined {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) return undefined;
  return auth.slice(7).trim();
}

/** Route guard — oturum yoksa 401 gönderir ve `null` döner. */
export function requireReseller(
  req: { headers: Record<string, unknown> },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): ResellerSession | null {
  const session = resolveResellerToken(bearerToken(req));
  if (!session) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return session;
}
