import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { emailFrom } from './email-addresses.js';
import { escapeHtml, renderDetailRows, renderEmailTemplate } from './email-template.js';
import { sendSmtpEmail } from './smtp.js';

export type SupportEmailInput = {
  businessName: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  message: string;
  source: string;
  ticketId: string;
  /** Till state sent with the request: version, licence, core, sync. */
  diagnostics?: Record<string, unknown> | null;
};

export function supportNotificationRecipients(): string {
  // No personal-address fallback: an unset SMTP_SUPPORT_TO used to silently
  // route every customer's support mail to one developer's inbox. Unset now
  // means "do not e-mail", which is fine — the admin panel is the real channel.
  const inbox = (process.env.SMTP_SUPPORT_TO ?? '').trim();
  const tarlan = env.emailTarlan;
  return [inbox, tarlan].filter(Boolean).join(', ');
}

export async function sendSupportRequestEmail(
  app: FastifyInstance,
  input: SupportEmailInput,
): Promise<boolean> {
  const to = supportNotificationRecipients();
  if (!to) {
    app.log.info('support_email_skipped_no_recipient');
    return true;
  }

  const rows = [
    { label: 'Biznes', value: input.businessName },
    { label: 'Məsul şəxs', value: input.contactPerson ?? '' },
    { label: 'Telefon', value: input.phone ?? '' },
    { label: 'E-poçt', value: input.email ?? '' },
    { label: 'Ünvan', value: input.address ?? '' },
    { label: 'Mənbə', value: input.source },
  ];

  const messageBlock = `<p style="margin:16px 0 0;padding:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`;

  // The till's own report of its state, in the e-mail itself. Without it the
  // first reply is always "which version, is it online, what does it say?" —
  // four questions that cost a round trip each.
  const diagnosticRows = Object.entries(input.diagnostics ?? {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => ({
      label,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
  const diagnosticsBlock = diagnosticRows.length
    ? `<p style="margin:18px 0 6px;font-weight:700;">Kassanın vəziyyəti</p>${renderDetailRows(diagnosticRows)}`
    : '';

  const adminUrl = `${env.adminPanelUrl.replace(/\/$/, '')}/support/${input.ticketId}`;

  const { html, text } = renderEmailTemplate({
    preheader: `${input.businessName} — ofis dəstək istəyir`,
    eyebrow: 'Canlı dəstək',
    title: input.businessName,
    bodyHtml: `<p style="margin:0 0 12px;">Restoran ofisindən yeni dəstək sorğusu gəldi. Admin paneldə qəbul edib canlı mesajlaşmağa başlayın.</p>${renderDetailRows(rows)}${messageBlock}${diagnosticsBlock}`,
    cta: { label: 'Dəstək sorğusunu aç', href: adminUrl },
    footerNote: 'Bu bildiriş possistem POS dəstək kanalından avtomatik göndərilib.',
  });

  try {
    const sent = await sendSmtpEmail({
      from: emailFrom.support(),
      replyTo: input.email?.trim() || emailFrom.support(),
      to,
      subject: `[possistem] Dəstək — ${input.businessName}`,
      text,
      html,
    });
    if (sent) app.log.info({ to, ticketId: input.ticketId }, 'support_email_sent');
    else app.log.info('support_email_skipped_no_smtp');
    return sent;
  } catch (error) {
    app.log.warn({ error, ticketId: input.ticketId }, 'support_email_failed');
    return false;
  }
}
