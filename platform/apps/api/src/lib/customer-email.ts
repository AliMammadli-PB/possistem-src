import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { emailFrom } from './email-addresses.js';
import { escapeHtml, renderEmailTemplate } from './email-template.js';
import { sendSmtpEmail } from './smtp.js';

export async function sendPasswordResetEmail(
  app: FastifyInstance,
  input: { to: string; name: string; resetUrl: string },
) {
  const safeName = escapeHtml(input.name);
  const { html, text } = renderEmailTemplate({
    preheader: 'Şifrə yeniləmə keçidi',
    eyebrow: 'Təhlükəsizlik',
    title: 'Şifrənizi yeniləyin',
    bodyHtml: `<p style="margin:0 0 12px;">Salam, <strong>${safeName}</strong>.</p>
      <p style="margin:0;">possistem hesabınız üçün şifrə yeniləmə sorğusu almışıq. Keçid <strong>30 dəqiqə</strong> ərzində etibarlıdır və yalnız bir dəfə istifadə oluna bilər.</p>
      <p style="margin:16px 0 0;">Bu sorğunu siz etməmisinizsə, bu məktubu nəzərə almayın.</p>`,
    cta: { label: 'Yeni şifrə yaradın', href: input.resetUrl },
  });

  const sent = await sendSmtpEmail({
    from: emailFrom.support(),
    replyTo: emailFrom.support(),
    to: input.to,
    subject: 'possistem — şifrənizi yeniləyin',
    text,
    html,
  });

  if (sent) app.log.info({ to: input.to }, 'customer_password_reset_email_sent');
  else app.log.info('customer_password_reset_email_skipped_no_provider');
}

export async function sendWelcomeEmail(
  app: FastifyInstance,
  input: { to: string; name: string },
) {
  const portalUrl = `${env.customerPortalUrl.replace(/\/+$/, '')}/login`;
  const safeName = escapeHtml(input.name);
  const { html, text } = renderEmailTemplate({
    preheader: 'Hesabınız hazırdır',
    eyebrow: 'Xoş gəldiniz',
    title: 'Hesabınız hazırdır',
    bodyHtml: `<p style="margin:0 0 12px;">Salam, <strong>${safeName}</strong>.</p>
      <p style="margin:0;">possistem müştəri hesabınız yaradıldı. Quraşdırmaya davam etmək üçün portala daxil olun.</p>`,
    cta: { label: 'Portala daxil olun', href: portalUrl },
  });

  const sent = await sendSmtpEmail({
    from: emailFrom.support(),
    replyTo: emailFrom.support(),
    to: input.to,
    subject: 'possistem — hesabınız hazırdır',
    text,
    html,
  });

  if (sent) app.log.info({ to: input.to }, 'customer_welcome_email_sent');
  else app.log.info('customer_welcome_email_skipped_no_provider');
}
