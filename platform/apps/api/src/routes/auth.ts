import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  LoginRequestSchema,
  ChangePasswordRequestSchema,
} from '@milioner/contracts';
import { sessions, users } from '@milioner/database';
import {
  verifyPassword,
  hashPassword,
  generateSessionToken,
  generateCsrfToken,
  hashSessionToken,
} from '@milioner/security';
import { env } from '../env.js';
import { parseBody, clientIp } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { requireAuth, currentUser } from '../plugins/auth.js';

export async function authRoutes(app: FastifyInstance) {
  // Keep unknown-account and wrong-password checks on the same expensive path so
  // response timing cannot be used to enumerate operator email addresses.
  const dummyPasswordHash = await hashPassword('milioner-invalid-account-sentinel');

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    },
    async (req, reply) => {
      const body = parseBody(LoginRequestSchema, req.body, reply);
      if (!body) return;

      const [user] = await app.db
        .select()
        .from(users)
        .where(eq(users.email, body.email.toLowerCase()))
        .limit(1);
      const ok = await verifyPassword(user?.passwordHash ?? dummyPasswordHash, body.password);
      if (!user || !user.active || !ok) {
        req.log.warn({ ip: clientIp(req) }, 'auth_login_rejected');
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const token = generateSessionToken();
      const csrfToken = generateCsrfToken();
      const expiresAt = new Date(Date.now() + env.sessionTtlHours * 3600_000);

      // Each device has its own session/CSRF pair. Logging in on Android must
      // not revoke the browser. Logout removes only the requesting session;
      // change-password still revokes every session of this operator.

      await app.db.insert(sessions).values({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        csrfToken,
        expiresAt,
        ip: clientIp(req),
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });

      const secure = env.nodeEnv === 'production' || env.cookieSecure;
      const cookieOpts = {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure,
        expires: expiresAt,
      };
      // Path=/pos matches all control API routes (/pos/api/*).
      reply.setCookie(env.cookieName, token, { ...cookieOpts, path: '/pos' });
      // Legacy path for older browsers / cached cookies.
      reply.setCookie(env.cookieName, token, { ...cookieOpts, path: '/' });

      await writeAudit(app, {
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        ip: clientIp(req),
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
        csrfToken,
        sessionToken: token,
        insecureTransport: env.insecureTransport,
      };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionId) {
      await app.db.delete(sessions).where(eq(sessions.id, req.sessionId));
      await writeAudit(app, {
        actorUserId: req.user?.id,
        action: 'auth.logout',
        entityType: 'user',
        entityId: req.user?.id,
        ip: clientIp(req),
      });
    }
    reply.clearCookie(env.cookieName, { path: '/', sameSite: 'lax' });
    reply.clearCookie(env.cookieName, { path: '/pos', sameSite: 'lax' });
    return { ok: true };
  });

  app.post('/auth/change-password', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const user = currentUser(req);
    const body = parseBody(ChangePasswordRequestSchema, req.body, reply);
    if (!body) return;

    const [row] = await app.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row) return reply.code(401).send({ error: 'Unauthorized' });

    const ok = await verifyPassword(row.passwordHash, body.currentPassword);
    if (!ok) return reply.code(400).send({ error: 'Current password incorrect' });

    const passwordHash = await hashPassword(body.newPassword);
    await app.db
      .update(users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, row.id));

    await app.db.delete(sessions).where(eq(sessions.userId, row.id));
    reply.clearCookie(env.cookieName, { path: '/', sameSite: 'lax' });
    reply.clearCookie(env.cookieName, { path: '/pos', sameSite: 'lax' });

    await writeAudit(app, {
      actorUserId: row.id,
      action: 'auth.change_password',
      entityType: 'user',
      entityId: row.id,
      ip: clientIp(req),
    });

    return { ok: true, reauth: true };
  });

  // Public pages may discover an existing console session without treating a
  // signed-out visitor as an authentication failure. Protected routes retain 401.
  app.get('/auth/session', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!req.user) return { authenticated: false, user: null, csrfToken: null };
    const user = currentUser(req);
    return {
      authenticated: true,
      user: { id: user.id, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
      csrfToken: req.csrfToken,
      insecureTransport: env.insecureTransport,
    };
  });

  app.get('/auth/me', async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!requireAuth(req, reply)) return;
    const user = currentUser(req);
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      csrfToken: req.csrfToken,
      insecureTransport: env.insecureTransport,
    };
  });
}
