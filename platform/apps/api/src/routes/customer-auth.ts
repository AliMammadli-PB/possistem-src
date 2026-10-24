import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  CustomerChangePasswordSchema,
  CustomerCheckEmailSchema,
  CustomerForgotPasswordSchema,
  CustomerLoginOtpSchema,
  CustomerLoginSchema,
  CustomerOtpSendSchema,
  CustomerRegisterSchema,
  CustomerResetPasswordSchema,
} from '@milioner/contracts';
import {
  customerOnboarding,
  customerPasswordResets,
  customerSessions,
  customers,
  licenses,
} from '@milioner/database';
import { licenseOwnerProduct as licensePosProduct, licenseOwnerProductSql } from '../lib/pos-product.js';
import {
  generateCsrfToken,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from '@milioner/security';
import { env } from '../env.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from '../lib/customer-email.js';
import {
  customerEmailExists,
  issueOtp,
  otpFailureMessage,
  verifyOtp,
} from '../lib/email-otp.js';
import { writeAudit } from '../lib/audit.js';
import { chatAvatarUrl } from '../lib/chat-avatar.js';
import { clientIp, parseBody } from '../lib/validate.js';
import { CUSTOMER_COOKIE_NAME, requireCustomer } from '../plugins/customer-auth.js';

async function licenseFields(app: FastifyInstance, customerId: string) {
  const rows = await app.db
    .select({ plan: licenses.plan, features: licenses.features, keyProduct:licenseOwnerProductSql })
    .from(licenses)
    .where(eq(licenses.customerId, customerId))
    .orderBy(desc(licenses.createdAt));
  const availableProducts = [...new Set(rows.map((row) => licensePosProduct(row,row.keyProduct)))];
  return {
    licenseProduct: rows[0] ? licensePosProduct(rows[0],rows[0].keyProduct) : null,
    availableProducts,
  };
}

const STANDARD_TTL_MS = 12 * 3600_000;
const REMEMBER_TTL_MS = 30 * 24 * 3600_000;
const RESET_TTL_MS = 30 * 60_000;
const secureCookie = env.nodeEnv === 'production' || env.cookieSecure;

function setCustomerCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(CUSTOMER_COOKIE_NAME, token, {
    path: '/pos',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
    expires: expiresAt,
  });
}

function clearCustomerCookie(reply: FastifyReply) {
  reply.clearCookie(CUSTOMER_COOKIE_NAME, { path: '/pos' });
}

async function createCustomerSession(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  input: { customerId: string; rememberMe: boolean },
) {
  const token = generateSessionToken();
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(
    Date.now() + (input.rememberMe ? REMEMBER_TTL_MS : STANDARD_TTL_MS),
  );

  await app.db.insert(customerSessions).values({
    customerId: input.customerId,
    tokenHash: hashSessionToken(token),
    csrfToken,
    rememberMe: input.rememberMe,
    expiresAt,
    ip: clientIp(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
  setCustomerCookie(reply, token, expiresAt);
  return { csrfToken, expiresAt: expiresAt.toISOString() };
}

function publicCustomer(customer: typeof customers.$inferSelect) {
  return {
    id: customer.id,
    name: customer.name,
    contactPerson: customer.contactPerson,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    voen: customer.voen,
    notifyEmail: customer.notifyEmail ?? customer.email,
    emailVerified: Boolean(customer.emailVerifiedAt),
    avatarUrl: customer.chatAvatarPath
      ? `${chatAvatarUrl(customer.id)}?v=${new Date(customer.updatedAt).getTime()}`
      : null,
  };
}

export async function customerAuthRoutes(app: FastifyInstance) {
  // Unknown accounts take the same Argon2 path as wrong passwords.
  const dummyPasswordHash = await hashPassword('milioner-customer-invalid-sentinel');

  app.post(
    '/customer-auth/check-email',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = parseBody(CustomerCheckEmailSchema, req.body, reply);
      if (!body) return;

      const exists = await customerEmailExists(app, body.email);
      if (!exists) {
        await verifyPassword(dummyPasswordHash, 'milioner-check-email-sentinel');
      }

      return {
        exists,
        message: exists
          ? 'Bu e-poçtla hesab tapıldı. Daxil ola və ya şifrənizi yeniləyə bilərsiniz.'
          : 'Bu e-poçtla hesab tapılmadı. Yeni hesab yarada bilərsiniz.',
      };
    },
  );

  app.post(
    '/customer-auth/otp/send',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const body = parseBody(CustomerOtpSendSchema, req.body, reply);
      if (!body) return;

      const exists = await customerEmailExists(app, body.email);
      if (body.purpose === 'register' && exists) {
        return reply.code(409).send({
          error: 'Bu e-poçtla hesab artıq mövcuddur. Daxil olun.',
          code: 'ACCOUNT_EXISTS',
        });
      }
      if ((body.purpose === 'login' || body.purpose === 'reset') && !exists) {
        await verifyPassword(dummyPasswordHash, 'milioner-otp-send-sentinel');
        return reply.code(202).send({
          ok: true,
          message: 'Hesab mövcuddursa, e-poçtunuza kod göndərildi.',
        });
      }

      const result = await issueOtp(app, { email: body.email, purpose: body.purpose });
      if (!result.sent) {
        return reply.code(503).send({
          error: 'Kod hazırda göndərilə bilmədi. Bir az sonra yenidən cəhd edin.',
          code: 'OTP_SEND_FAILED',
        });
      }

      return reply.code(202).send({
        ok: true,
        message: '6 rəqəmli kod e-poçtunuza göndərildi.',
        ...(result.devCode ? { devCode: result.devCode } : {}),
      });
    },
  );

  app.post(
    '/customer-auth/login-otp',
    { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = parseBody(CustomerLoginOtpSchema, req.body, reply);
      if (!body) return;

      const [customer] = await app.db
        .select()
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${body.email}`, eq(customers.active, true)))
        .limit(1);

      const verified = await verifyOtp(app, { email: body.email, purpose: 'login', code: body.code });
      if (!customer || !verified.ok) {
        req.log.warn({ ip: clientIp(req) }, 'customer_login_otp_rejected');
        return reply.code(401).send({
          error: customer ? otpFailureMessage(verified.ok ? 'invalid' : verified.reason) : 'E-poçt və ya kod düzgün deyil.',
          code: 'INVALID_OTP',
        });
      }

      const [onboarding] = await app.db
        .select()
        .from(customerOnboarding)
        .where(eq(customerOnboarding.customerId, customer.id))
        .limit(1);
      if (!onboarding) {
        await app.db
          .insert(customerOnboarding)
          .values({ customerId: customer.id })
          .onConflictDoNothing();
      }

      const session = await createCustomerSession(app, req, reply, {
        customerId: customer.id,
        rememberMe: body.rememberMe,
      });
      await writeAudit(app, {
        actorCustomerId: customer.id,
        action: 'customer.login_otp',
        entityType: 'customer',
        entityId: customer.id,
        ip: clientIp(req),
      });

      return {
        customer: publicCustomer(customer),
        ...session,
        ...(await licenseFields(app, customer.id)),
        onboardingComplete: Boolean(onboarding?.completedAt),
        redirectTo: onboarding?.completedAt ? '/' : '/onboarding/welcome',
      };
    },
  );

  app.post(
    '/customer-auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parseBody(CustomerRegisterSchema, req.body, reply);
      if (!body) return;

      const otp = await verifyOtp(app, {
        email: body.email,
        purpose: 'register',
        code: body.otpCode,
      });
      if (!otp.ok) {
        return reply.code(400).send({
          error: otpFailureMessage(otp.reason),
          code: 'OTP_INVALID',
        });
      }

      const [existing] = await app.db
        .select({ id: customers.id })
        .from(customers)
        .where(sql`lower(${customers.email}) = ${body.email}`)
        .limit(1);
      if (existing) {
        return reply.code(409).send({
          error: 'Bu e-poçtla hesab artıq mövcuddur. Daxil olun və ya şifrəni yeniləyin.',
          code: 'ACCOUNT_EXISTS',
        });
      }

      const passwordHash = await hashPassword(body.password);
      const now = new Date();
      let customer: typeof customers.$inferSelect;
      try {
        customer = await app.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(customers)
            .values({
              name: body.businessName,
              contactPerson: body.name,
              email: body.email,
              notifyEmail: body.email,
              emailVerifiedAt: now,
              passwordHash,
              mustChangePassword: false,
              termsAcceptedAt: now,
              registrationSource: 'web',
              active: true,
            })
            .returning();
          if (!created) throw new Error('Customer registration failed');
          await tx.insert(customerOnboarding).values({
            customerId: created.id,
            currentStep: 1,
            completedSteps: [],
          });
          return created;
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return reply.code(409).send({
            error: 'Bu e-poçtla hesab artıq mövcuddur. Daxil olun və ya şifrəni yeniləyin.',
            code: 'ACCOUNT_EXISTS',
          });
        }
        throw error;
      }

      const session = await createCustomerSession(app, req, reply, {
        customerId: customer.id,
        rememberMe: false,
      });
      await writeAudit(app, {
        actorCustomerId: customer.id,
        action: 'customer.register',
        entityType: 'customer',
        entityId: customer.id,
        ip: clientIp(req),
      });
      void sendWelcomeEmail(app, {
        to: body.email,
        name: body.name,
      }).catch((error) => app.log.warn({ error }, 'customer_welcome_email_failed'));

      return reply.code(201).send({
        customer: publicCustomer(customer),
        ...session,
        ...(await licenseFields(app, customer.id)),
        onboardingComplete: false,
        redirectTo: '/onboarding/welcome',
      });
    },
  );

  app.post(
    '/customer-auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = parseBody(CustomerLoginSchema, req.body, reply);
      if (!body) return;

      const [customer] = await app.db
        .select()
        .from(customers)
        .where(sql`lower(${customers.email}) = ${body.email}`)
        .limit(1);
      const valid = await verifyPassword(customer?.passwordHash ?? dummyPasswordHash, body.password);
      if (!customer || !customer.active || !customer.passwordHash || !valid) {
        req.log.warn({ ip: clientIp(req) }, 'customer_login_rejected');
        return reply.code(401).send({
          error: 'E-poçt və ya şifrə düzgün deyil.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      const [onboarding] = await app.db
        .select()
        .from(customerOnboarding)
        .where(eq(customerOnboarding.customerId, customer.id))
        .limit(1);
      if (!onboarding) {
        await app.db
          .insert(customerOnboarding)
          .values({ customerId: customer.id })
          .onConflictDoNothing();
      }

      const session = await createCustomerSession(app, req, reply, {
        customerId: customer.id,
        rememberMe: body.rememberMe,
      });
      await writeAudit(app, {
        actorCustomerId: customer.id,
        action: 'customer.login',
        entityType: 'customer',
        entityId: customer.id,
        ip: clientIp(req),
      });

      return {
        customer: publicCustomer(customer),
        ...session,
        ...(await licenseFields(app, customer.id)),
        onboardingComplete: Boolean(onboarding?.completedAt),
        redirectTo: onboarding?.completedAt ? '/' : '/onboarding/welcome',
      };
    },
  );

  app.post('/customer-auth/logout', async (req, reply) => {
    if (req.customerSessionId) {
      await app.db
        .delete(customerSessions)
        .where(eq(customerSessions.id, req.customerSessionId));
    }
    clearCustomerCookie(reply);
    return { ok: true };
  });

  app.get('/customer-auth/me', async (req, reply) => {
    const identity = req.customer;
    if (!identity) {
      return {
        authenticated: false,
        customer: null,
        csrfToken: null,
        onboardingComplete: false,
        currentStep: 1,
      };
    }

    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, identity.id))
      .limit(1);
    if (!customer) {
      clearCustomerCookie(reply);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const [onboarding] = await app.db
      .select()
      .from(customerOnboarding)
      .where(eq(customerOnboarding.customerId, customer.id))
      .limit(1);

    return {
      authenticated: true,
      customer: publicCustomer(customer),
      csrfToken: req.customerCsrfToken,
      onboardingComplete: Boolean(onboarding?.completedAt),
      currentStep: onboarding?.currentStep ?? 1,
      ...(await licenseFields(app, customer.id)),
    };
  });

  app.post(
    '/customer-auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parseBody(CustomerForgotPasswordSchema, req.body, reply);
      if (!body) return;

      const [customer] = await app.db
        .select()
        .from(customers)
        .where(and(sql`lower(${customers.email}) = ${body.email}`, eq(customers.active, true)))
        .limit(1);

      let devResetUrl: string | undefined;
      if (customer?.email) {
        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + RESET_TTL_MS);
        await app.db.transaction(async (tx) => {
          await tx
            .update(customerPasswordResets)
            .set({ usedAt: new Date() })
            .where(
              and(
                eq(customerPasswordResets.customerId, customer.id),
                isNull(customerPasswordResets.usedAt),
              ),
            );
          await tx.insert(customerPasswordResets).values({
            customerId: customer.id,
            tokenHash: hashSessionToken(token),
            expiresAt,
            requestedIp: clientIp(req),
          });
        });
        const resetUrl = `${env.customerPortalUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
        void sendPasswordResetEmail(app, {
          to: customer.email,
          name: customer.contactPerson || customer.name,
          resetUrl,
        }).catch((error) => app.log.warn({ error }, 'customer_password_reset_email_failed'));
        if (env.nodeEnv !== 'production') devResetUrl = resetUrl;
      } else {
        await verifyPassword(dummyPasswordHash, 'milioner-forgot-password-sentinel');
      }

      return reply.code(202).send({
        ok: true,
        message: 'Hesab mövcuddursa, şifrə yeniləmə keçidi e-poçta göndərildi.',
        ...(devResetUrl ? { devResetUrl } : {}),
      });
    },
  );

  app.post(
    '/customer-auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parseBody(CustomerResetPasswordSchema, req.body, reply);
      if (!body) return;

      const [row] = await app.db
        .select({
          reset: customerPasswordResets,
          customer: customers,
        })
        .from(customerPasswordResets)
        .innerJoin(customers, eq(customerPasswordResets.customerId, customers.id))
        .where(
          and(
            eq(customerPasswordResets.tokenHash, hashSessionToken(body.token)),
            isNull(customerPasswordResets.usedAt),
            gt(customerPasswordResets.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!row || !row.customer.active) {
        return reply.code(400).send({
          error: 'Şifrə yeniləmə keçidi etibarsızdır və ya vaxtı bitib.',
          code: 'RESET_INVALID',
        });
      }

      const passwordHash = await hashPassword(body.password);
      await app.db.transaction(async (tx) => {
        await tx
          .update(customers)
          .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
          .where(eq(customers.id, row.customer.id));
        await tx
          .update(customerPasswordResets)
          .set({ usedAt: new Date() })
          .where(eq(customerPasswordResets.customerId, row.customer.id));
        await tx
          .delete(customerSessions)
          .where(eq(customerSessions.customerId, row.customer.id));
      });
      clearCustomerCookie(reply);
      await writeAudit(app, {
        actorCustomerId: row.customer.id,
        action: 'customer.password_reset',
        entityType: 'customer',
        entityId: row.customer.id,
        ip: clientIp(req),
      });
      return { ok: true };
    },
  );

  app.post('/customer-auth/change-password', async (req, reply) => {
    const identity = requireCustomer(req, reply);
    if (!identity) return;
    const body = parseBody(CustomerChangePasswordSchema, req.body, reply);
    if (!body) return;

    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, identity.id))
      .limit(1);
    if (!customer?.passwordHash || !(await verifyPassword(customer.passwordHash, body.currentPassword))) {
      return reply.code(400).send({
        error: 'Cari şifrə düzgün deyil.',
        code: 'CURRENT_PASSWORD_INVALID',
      });
    }

    const passwordHash = await hashPassword(body.newPassword);
    await app.db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
        .where(eq(customers.id, customer.id));
      await tx.delete(customerSessions).where(eq(customerSessions.customerId, customer.id));
    });
    clearCustomerCookie(reply);
    await writeAudit(app, {
      actorCustomerId: customer.id,
      action: 'customer.password_change',
      entityType: 'customer',
      entityId: customer.id,
      ip: clientIp(req),
    });
    return { ok: true, reauth: true };
  });
}
