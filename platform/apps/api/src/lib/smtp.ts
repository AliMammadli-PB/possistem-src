import { Resend } from 'resend';
import { env } from '../env.js';

export type SmtpMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
};

function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : to.split(',').map((entry) => entry.trim());
  return list.filter(Boolean);
}

export function isEmailConfigured(): boolean {
  return Boolean(env.resendApiKey || env.smtpHost);
}

async function sendViaResend(input: SmtpMessage): Promise<boolean> {
  if (!env.resendApiKey) return false;

  const resend = new Resend(env.resendApiKey);
  const { error } = await resend.emails.send({
    from: input.from ?? env.emailFrom,
    to: normalizeRecipients(input.to),
    subject: input.subject,
    text: input.text,
    html: input.html ?? input.text.replace(/\n/g, '<br>'),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });

  if (error) {
    throw new Error(error.message);
  }
  return true;
}

async function sendViaSmtp(input: SmtpMessage): Promise<boolean> {
  if (!env.smtpHost) return false;

  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });

  await transport.sendMail({
    from: input.from ?? env.emailFrom,
    replyTo: input.replyTo,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return true;
}

/** Resend first, then classic SMTP fallback. */
export async function sendSmtpEmail(input: SmtpMessage): Promise<boolean> {
  if (env.resendApiKey) {
    return sendViaResend(input);
  }
  return sendViaSmtp(input);
}

export async function verifySmtpConnection(): Promise<void> {
  if (env.resendApiKey) {
    if (!env.emailFrom) {
      throw new Error('RESEND_FROM or SMTP_FROM is not configured');
    }
    return;
  }

  if (!env.smtpHost) {
    throw new Error('Neither RESEND_API_KEY nor SMTP_HOST is configured');
  }

  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });

  await transport.verify();
}
