import fp from 'fastify-plugin';
import { eq, and, gt } from 'drizzle-orm';
import { sessions, users, type User } from '@milioner/database';
import { hashSessionToken } from '@milioner/security';
import { env } from '../env.js';

export type AuthUser = Pick<User, 'id' | 'email' | 'role' | 'mustChangePassword' | 'active'>;

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionId: string | null;
    csrfToken: string | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT = new Set([
  '/pos/api/auth/login',
  '/pos/api/activation/redeem',
  '/pos/api/activation/lookup',
  '/pos/api/tenant/login',
  '/pos/api/tenant/logout',
  '/pos/api/public/contact',
  // Bayi portalı Bearer token kullanır; aynı tarayıcıda super admin çerezi
  // varsa CSRF kontrolü bu uçları yanlışlıkla 403'lemesin.
  '/pos/api/reseller/login',
  '/pos/api/reseller/logout',
  // Müştəri portalı ayrı çerez/CSRF istifadə edir. Admin oturumu eyni origin-də
  // qaldıqda bu açıq uçlar admin CSRF-inə düşməməlidir.
  '/pos/api/customer-auth/login',
  '/pos/api/customer-auth/register',
  '/pos/api/customer-auth/forgot-password',
  '/pos/api/customer-auth/reset-password',
]);

// Admin çerezi bütün /pos/api sorğularına yapışır. Müştəri/bayi/tenant
// ad məkanları öz auth modelinə malikdir; admin CSRF yalnız admin
// paneli mutasiyalarına aid olmalıdır.
const ADMIN_CSRF_SKIP_PREFIXES = [
  '/pos/api/billing/', // Signed Epoint callbacks, native bearer and limited checkout CSRF.
  '/pos/api/partner/', // Separate partner cookie, origin and CSRF checks.
  '/pos/api/customer-auth/',
  '/pos/api/customer/',
  '/pos/api/reseller/',
  '/pos/api/owner/',
  '/pos/api/tenant/',
  '/pos/api/activation/',
  '/pos/api/devices/',
];

function pathOnly(url: string): string {
  const raw = url.split('?')[0] ?? '';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Fallback when browsers drop HttpOnly cookies (Cloudflare / path quirks). */
export const ADMIN_SESSION_HEADER = 'x-admin-session';

function readAdminSessionToken(req: { cookies: Record<string, string | undefined>; headers: Record<string, unknown> }): string | null {
  const fromCookie = req.cookies[env.cookieName];
  if (fromCookie) return fromCookie;
  const header = req.headers[ADMIN_SESSION_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('csrfToken', null);

  app.addHook('preHandler', async (req, reply) => {
    const raw = readAdminSessionToken(req);
    if (!raw) return;

    // Bayi (/pos/bayi/) ve sahibkar (/pos/app/) panelləri super admin ilə eyni
    // origin-dədir, ona görə brauzer `milioner_session` cookie-sini onların Bearer
    // sorğularına da avtomatik qoşur. Cookie sessiyasını burada tamamilə
    // görməzdən gəlirik: Bearer sorğusu cookie ilə yox, token ilə kimlik
    // təsdiqləyir, deməli CSRF də ona aid deyil. Cross-site hücum Bearer
    // başlığı qoya bilmir — bunun üçün CORS preflight lazımdır və icazə
    // siyahısı kənar origin-ləri rədd edir.
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return;

    const tokenHash = hashSessionToken(raw);
    const rows = await app.db
      .select({
        sessionId: sessions.id,
        csrfToken: sessions.csrfToken,
        expiresAt: sessions.expiresAt,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);

    const row = rows[0];
    if (!row || !row.user.active) return;

    req.user = {
      id: row.user.id,
      email: row.user.email,
      role: row.user.role,
      mustChangePassword: row.user.mustChangePassword,
      active: row.user.active,
    };
    req.sessionId = row.sessionId;
    req.csrfToken = row.csrfToken;

    const path = pathOnly(req.url);
    if (CSRF_EXEMPT.has(path)) return;
    if (ADMIN_CSRF_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
    // Customer chat uses the customer CSRF cookie. An admin session in the
    // same browser must not block those uploads/posts. Staff routes still
    // require admin CSRF (`/public/chat/staff/`).
    if (
      path.startsWith('/pos/api/public/chat/') &&
      !path.startsWith('/pos/api/public/chat/staff/')
    ) {
      return;
    }
    if (path.startsWith('/pos/api/public/visits')) return;

    // CSRF for state-changing methods when authenticated
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      const csrf = typeof header === 'string' ? header : undefined;
      if (!csrf || csrf !== row.csrfToken) {
        return reply.code(403).send({ error: 'CSRF token missing or invalid' });
      }
    }
  });
});

export function requireAuth(
  req: { user: AuthUser | null },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Super admin uçlarının tek kapısı.
 *
 * `requireAuth` sadece "oturum var mı" diye baktığı için rol kontrolü burada
 * yapılır: ileride `users` tablosuna daha az yetkili bir rol eklenirse bu uçlar
 * kendiliğinden kapalı kalır.
 */
export function requireSuperadmin(
  req: { user: AuthUser | null },
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  if (req.user.role !== 'superadmin') {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function currentUser(req: { user: AuthUser | null }): AuthUser {
  if (!req.user) throw new Error('expected authenticated user');
  return req.user;
}
