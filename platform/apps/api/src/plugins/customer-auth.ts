import fp from 'fastify-plugin';
import { and, eq, gt } from 'drizzle-orm';
import { customerSessions, customers } from '@milioner/database';
import { hashSessionToken } from '@milioner/security';
import { env } from '../env.js';

export const CUSTOMER_COOKIE_NAME = `${env.cookieName}_customer`;

export type CustomerIdentity = {
  id: string;
  email: string;
  name: string;
  active: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    customer: CustomerIdentity | null;
    customerSessionId: string | null;
    customerCsrfToken: string | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const PUBLIC_MUTATIONS = new Set([
  '/pos/api/customer-auth/register',
  '/pos/api/customer-auth/login',
  '/pos/api/customer-auth/login-otp',
  '/pos/api/customer-auth/check-email',
  '/pos/api/customer-auth/otp/send',
  '/pos/api/customer-auth/forgot-password',
  '/pos/api/customer-auth/reset-password',
]);

// Müştəri çerezi eyni origin-də admin/bayi sorğularına da yapışır.
// CSRF yalnız müştəri portalı mutasiyalarına aid olmalıdır; əks halda
// açıq admin login (`/pos/api/auth/login`) 403 qaytarır.
const CUSTOMER_CSRF_PREFIXES = [
  '/pos/api/customer-auth/',
  '/pos/api/customer/',
  '/pos/api/public/chat/',
  // Portal also mutates /owner/* (WhatsApp, chat bot, settings) with the
  // customer session cookie — CSRF must cover those too.
  '/pos/api/owner/',
];

function pathOnly(url: string): string {
  const raw = url.split('?')[0] ?? '';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

export const customerAuthPlugin = fp(async (app) => {
  app.decorateRequest('customer', null);
  app.decorateRequest('customerSessionId', null);
  app.decorateRequest('customerCsrfToken', null);

  app.addHook('preHandler', async (req, reply) => {
    const raw = req.cookies[CUSTOMER_COOKIE_NAME];
    if (!raw) return;

    const [row] = await app.db
      .select({
        sessionId: customerSessions.id,
        csrfToken: customerSessions.csrfToken,
        lastSeenAt: customerSessions.lastSeenAt,
        customer: customers,
      })
      .from(customerSessions)
      .innerJoin(customers, eq(customerSessions.customerId, customers.id))
      .where(
        and(
          eq(customerSessions.tokenHash, hashSessionToken(raw)),
          gt(customerSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row || !row.customer.active || !row.customer.email) return;

    req.customer = {
      id: row.customer.id,
      email: row.customer.email,
      name: row.customer.name,
      active: row.customer.active,
    };
    req.customerSessionId = row.sessionId;
    req.customerCsrfToken = row.csrfToken;

    if (Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
      void app.db
        .update(customerSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(customerSessions.id, row.sessionId))
        .catch((error) => req.log.warn({ error }, 'customer_session_touch_failed'));
    }

    const path = pathOnly(req.url);
    if (PUBLIC_MUTATIONS.has(path) || SAFE_METHODS.has(req.method)) return;
    // Staff chat moderation uses the admin session/CSRF, not the customer cookie.
    if (path.startsWith('/pos/api/public/chat/staff/')) return;
    if (!CUSTOMER_CSRF_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

    const header = req.headers['x-csrf-token'];
    const csrf = typeof header === 'string' ? header : undefined;
    if (!csrf || csrf !== row.csrfToken) {
      return reply.code(403).send({ error: 'CSRF token missing or invalid' });
    }
  });
});

export function requireCustomer(
  req: { customer: CustomerIdentity | null },
  reply: { code: (status: number) => { send: (body: unknown) => unknown } },
): CustomerIdentity | null {
  if (!req.customer) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return req.customer;
}
