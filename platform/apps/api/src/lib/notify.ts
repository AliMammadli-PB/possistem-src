import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  customers,
  ownerNotifications,
  ownerPushSubscriptions,
  ownerWhatsappSettings,
} from '@milioner/database';
import { env } from '../env.js';
import { renderTemplate, sendWhatsappText } from './whatsapp.js';
import { isEmailConfigured, sendSmtpEmail } from './smtp.js';
import { emailFrom } from './email-addresses.js';
import { escapeHtml, renderEmailTemplate } from './email-template.js';

export async function createOwnerNotification(
  app: FastifyInstance,
  input: {
    customerId: string;
    kind: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  },
) {
  const [row] = await app.db
    .insert(ownerNotifications)
    .values({
      customerId: input.customerId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
    })
    .returning();

  void deliverEmail(app, input.customerId, input.title, input.body).catch((err) => {
    app.log.warn({ err }, 'owner_email_failed');
  });
  void deliverPush(app, input.customerId, input.title, input.body).catch((err) => {
    app.log.warn({ err }, 'owner_push_failed');
  });
  if (input.kind === 'x_report' || input.kind === 'z_report') {
    void deliverWhatsapp(app, input.customerId, input.title, input.body).catch((err) => {
      app.log.warn({ err }, 'owner_whatsapp_failed');
    });
  }

  return row;
}

async function deliverWhatsapp(
  app: FastifyInstance,
  customerId: string,
  title: string,
  body: string,
) {
  const [settings] = await app.db
    .select()
    .from(ownerWhatsappSettings)
    .where(eq(ownerWhatsappSettings.customerId, customerId))
    .limit(1);
  if (!settings?.enabled || !settings.recipientPhone) {
    app.log.info({ customerId }, 'owner_whatsapp_skipped_not_configured');
    return;
  }
  const text = renderTemplate(settings.messageTemplate, {
    admin: settings.adminName || 'Admin',
    title,
    body,
  });
  const result = await sendWhatsappText(customerId, settings.recipientPhone, text);
  if (!result.ok) {
    app.log.warn({ customerId, error: result.error }, 'owner_whatsapp_send_failed');
    return;
  }
  app.log.info({ customerId, title }, 'owner_whatsapp_sent');
}

async function deliverEmail(
  app: FastifyInstance,
  customerId: string,
  title: string,
  body: string,
) {
  const [customer] = await app.db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const to = customer?.notifyEmail || customer?.email;
  if (!to) return;

  if (!isEmailConfigured()) {
    app.log.info({ to, title }, 'owner_email_skipped_no_provider');
    return;
  }

  const { html, text } = renderEmailTemplate({
    preheader: title,
    eyebrow: 'Bildiriş',
    title,
    bodyHtml: `<p style="margin:0;white-space:pre-line;">${escapeHtml(body)}</p>`,
    cta: { label: 'Portalı aç', href: env.customerPortalUrl },
  });

  await sendSmtpEmail({
    from: emailFrom.admin(),
    replyTo: emailFrom.support(),
    to,
    subject: `[possistem] ${title}`,
    text,
    html,
  });
  app.log.info({ to, title }, 'owner_email_sent');
}

async function deliverPush(
  app: FastifyInstance,
  customerId: string,
  title: string,
  body: string,
) {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    app.log.info('owner_push_skipped_no_vapid');
    return;
  }

  // web-push is CommonJS: under Node's ESM loader its exports arrive nested
  // under `default`, so calling them off the namespace threw
  // "setVapidDetails is not a function" on every single report. Same shape as
  // `loadAutoUpdater()` in the desktop updater.
  const mod = await import('web-push');
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);

  const subs = await app.db
    .select()
    .from(ownerPushSubscriptions)
    .where(eq(ownerPushSubscriptions.customerId, customerId));

  const payload = JSON.stringify({ title, body });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      );
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode?: number }).statusCode)
          : 0;
      if (status === 404 || status === 410) {
        await app.db
          .delete(ownerPushSubscriptions)
          .where(eq(ownerPushSubscriptions.id, sub.id));
      } else {
        app.log.warn({ err, endpoint: sub.endpoint.slice(0, 48) }, 'owner_push_one_failed');
      }
    }
  }
}
