import type { FastifyInstance } from 'fastify';
import { emailFrom, leadNotificationRecipients } from './email-addresses.js';
import { escapeHtml, renderDetailRows, renderEmailTemplate } from './email-template.js';
import { sendSmtpEmail } from './smtp.js';

type LeadEmailInput = {
  name: string;
  businessName: string;
  phone: string;
  city?: string | null;
  message?: string | null;
  source?: string | null;
  product?: string | null; /* topdan-product: type */
};

export async function sendLeadNotificationEmail(
  app: FastifyInstance,
  input: LeadEmailInput,
): Promise<void> {
  const to = leadNotificationRecipients();
  if (!to) {
    app.log.info('lead_email_skipped_no_recipient');
    return;
  }

  const rows = [
    { label: 'Ad', value: input.name },
    { label: 'Biznes', value: input.businessName },
    { label: 'Telefon', value: input.phone },
    { label: 'Şəhər', value: input.city ?? '' },
    { label: 'Məhsul', value: ({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS', topdan: 'Topdan POS' } as Record<string, string>)[input.product ?? ''] ?? 'seçilməyib' }, /* topdan-product: row */
    { label: 'Mənbə', value: input.source ?? 'sayt' },
  ];

  const messageBlock = input.message
    ? `<p style="margin:16px 0 0;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`
    : '';

  const { html, text } = renderEmailTemplate({
    preheader: `${input.businessName} — yeni sorğu`,
    eyebrow: 'Yeni sorğu',
    title: input.businessName,
    bodyHtml: `<p style="margin:0 0 12px;">Saytdan yeni qiymət sorğusu daxil olub. Tezliklə geri dönüş edin.</p>${renderDetailRows(rows)}${messageBlock}`,
    cta: { label: 'Admin panelə keç', href: 'https://possistem.az/pos/' },
    footerNote: 'Bu bildiriş possistem.az sorğu formasından avtomatik göndərilib.',
  });

  try {
    const sent = await sendSmtpEmail({
      from: emailFrom.info(),
      replyTo: emailFrom.support(),
      to,
      subject: `[possistem] Yeni sorğu — ${input.businessName}`,
      text,
      html,
    });
    if (sent) app.log.info({ to }, 'lead_email_sent');
    else app.log.info('lead_email_skipped_no_smtp');
  } catch (error) {
    app.log.warn({ error }, 'lead_email_failed');
  }
}
