import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { emailOtpCodes } from '@milioner/database';
import { hashPassword, verifyPassword } from '@milioner/security';
import { emailFrom } from './email-addresses.js';
import { escapeHtml, renderEmailTemplate } from './email-template.js';
import { sendSmtpEmail } from './smtp.js';

export type OtpPurpose = 'login' | 'register' | 'reset';

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const dummyOtpHashPromise = hashPassword('000000');

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function hashCode(code: string): Promise<string> {
  return hashPassword(code);
}

async function verifyCode(hash: string, code: string): Promise<boolean> {
  return verifyPassword(hash, code);
}

export async function sendOtpEmail(input: {
  to: string;
  code: string;
  purpose: OtpPurpose;
  name?: string;
}): Promise<boolean> {
  const purposeLabel =
    input.purpose === 'register'
      ? 'Hesab təsdiqi'
      : input.purpose === 'login'
        ? 'Giriş kodu'
        : 'Təhlükəsizlik kodu';

  const greeting = input.name ? `Salam, <strong>${escapeHtml(input.name)}</strong>.` : 'Salam.';
  const { html } = renderEmailTemplate({
    preheader: `${input.code} — possistem təsdiq kodu`,
    eyebrow: purposeLabel,
    title: 'Təsdiq kodunuz',
    bodyHtml: `<p style="margin:0 0 16px;">${greeting}</p>
      <p style="margin:0 0 20px;">possistem üçün 6 rəqəmli təsdiq kodunuz aşağıdadır. Kod <strong>10 dəqiqə</strong> ərzində etibarlıdır.</p>
      <div style="margin:0 0 8px;padding:20px 16px;border-radius:14px;background:#1c140e;text-align:center;">
        <span style="display:inline-block;font-family:Consolas,Monaco,monospace;font-size:36px;font-weight:800;letter-spacing:0.32em;color:#f2a45f;">${escapeHtml(input.code)}</span>
      </div>
      <p style="margin:16px 0 0;font-size:13px;color:#6b5c4f;">Bu kodu heç kimlə paylaşmayın. Sorğunu siz etməmisinizsə, məktubu nəzərə almayın.</p>`,
    footerNote: 'Bu kod avtomatik göndərilib və yalnız bir dəfə istifadə oluna bilər.',
  });

  return sendSmtpEmail({
    from: emailFrom.support(),
    replyTo: emailFrom.support(),
    to: input.to,
    subject: `possistem — ${purposeLabel}: ${input.code}`,
    text: `${purposeLabel}\n\nKodunuz: ${input.code}\n\nKod 10 dəqiqə ərzində etibarlıdır.`,
    html,
  });
}

export async function issueOtp(
  app: FastifyInstance,
  input: { email: string; purpose: OtpPurpose; toAddress?: string; name?: string },
): Promise<{ sent: boolean; devCode?: string }> {
  const email = normalizeEmail(input.email);
  const code = generateCode();
  const codeHash = await hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await app.db
    .update(emailOtpCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        sql`lower(${emailOtpCodes.email}) = ${email}`,
        eq(emailOtpCodes.purpose, input.purpose),
        isNull(emailOtpCodes.usedAt),
      ),
    );

  await app.db.insert(emailOtpCodes).values({
    email,
    purpose: input.purpose,
    codeHash,
    expiresAt,
  });

  const sent = await sendOtpEmail({
    to: input.toAddress ?? email,
    code,
    purpose: input.purpose,
    name: input.name,
  });

  return {
    sent,
    ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
  };
}

export async function verifyOtp(
  app: FastifyInstance,
  input: { email: string; purpose: OtpPurpose; code: string },
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'locked' }> {
  const email = normalizeEmail(input.email);
  const [row] = await app.db
    .select()
    .from(emailOtpCodes)
    .where(
      and(
        sql`lower(${emailOtpCodes.email}) = ${email}`,
        eq(emailOtpCodes.purpose, input.purpose),
        isNull(emailOtpCodes.usedAt),
        gt(emailOtpCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(emailOtpCodes.createdAt))
    .limit(1);

  if (!row) {
    await verifyCode(await dummyOtpHashPromise, input.code);
    return { ok: false, reason: 'expired' };
  }

  if (row.attemptCount >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'locked' };
  }

  const valid = await verifyCode(row.codeHash, input.code);
  if (!valid) {
    await app.db
      .update(emailOtpCodes)
      .set({ attemptCount: row.attemptCount + 1 })
      .where(eq(emailOtpCodes.id, row.id));
    return { ok: false, reason: 'invalid' };
  }

  await app.db
    .update(emailOtpCodes)
    .set({ usedAt: new Date() })
    .where(eq(emailOtpCodes.id, row.id));

  return { ok: true };
}

/** Constant-time-ish existence probe for public forms. */
export async function customerEmailExists(app: FastifyInstance, email: string): Promise<boolean> {
  const { customers } = await import('@milioner/database');
  const [row] = await app.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(sql`lower(${customers.email}) = ${normalizeEmail(email)}`, eq(customers.active, true)))
    .limit(1);
  return Boolean(row);
}

export function otpFailureMessage(reason: 'invalid' | 'expired' | 'locked'): string {
  if (reason === 'locked') {
    return 'Çox sayda səhv cəhd. Yeni kod istəyin.';
  }
  if (reason === 'expired') {
    return 'Kodun vaxtı bitib və ya etibarsızdır. Yeni kod istəyin.';
  }
  return 'Təsdiq kodu düzgün deyil.';
}
