import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { env } from '../env.js';
import {
  customers,
  supportAttachments,
  supportMessages,
  supportTickets,
  type SupportMessage,
  type SupportTicket,
} from '@milioner/database';
import { createOwnerNotification } from './notify.js';

const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

export type SupportMessageRow = {
  id: string;
  ticketId: string;
  authorKind: string;
  authorUserId: string | null;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

export function serializeMessage(row: SupportMessage): SupportMessageRow {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorKind: row.authorKind,
    authorUserId: row.authorUserId ?? null,
    body: row.body,
    meta: row.meta ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeTicket(
  row: SupportTicket,
  customer?: { name: string; email: string | null; phone: string | null },
) {
  return {
    id: row.id,
    customerId: row.customerId,
    deviceId: row.deviceId ?? null,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    subject: row.subject ?? null,
    claimedBy: row.claimedBy ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastCustomerAt: row.lastCustomerAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerName: customer?.name ?? null,
    customerEmail: customer?.email ?? null,
    customerPhone: customer?.phone ?? null,
  };
}

async function customerBrief(app: FastifyInstance, customerId: string) {
  const [row] = await app.db
    .select({
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      contactPerson: customers.contactPerson,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return row ?? null;
}

async function insertMessage(
  app: FastifyInstance,
  ticketId: string,
  authorKind: 'customer' | 'admin' | 'system',
  body: string,
  opts?: { authorUserId?: string; meta?: Record<string, unknown>; touchCustomer?: boolean },
) {
  const now = new Date();
  const [message] = await app.db
    .insert(supportMessages)
    .values({
      ticketId,
      authorKind,
      authorUserId: opts?.authorUserId ?? null,
      body,
      meta: opts?.meta ?? {},
    })
    .returning();

  await app.db
    .update(supportTickets)
    .set({
      lastMessageAt: now,
      updatedAt: now,
      // One rule: a customer message stamps lastCustomerAt. `touchCustomer`
      // said the same thing twice.
      ...(authorKind === 'customer' || opts?.touchCustomer ? { lastCustomerAt: now } : {}),
    })
    .where(eq(supportTickets.id, ticketId));

  return message!;
}

async function getOrCreatePresenceTicket(
  app: FastifyInstance,
  customerId: string,
  deviceId?: string | null,
) {
  const [existing] = await app.db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.customerId, customerId), eq(supportTickets.kind, 'presence')))
    .limit(1);

  if (existing) {
    if (deviceId && existing.deviceId !== deviceId) {
      await app.db
        .update(supportTickets)
        .set({ deviceId, updatedAt: new Date() })
        .where(eq(supportTickets.id, existing.id));
    }
    return existing;
  }

  const [created] = await app.db
    .insert(supportTickets)
    .values({
      customerId,
      deviceId: deviceId ?? null,
      kind: 'presence',
      status: 'open',
      priority: 'normal',
      subject: 'POS siqnal',
    })
    .returning();

  return created!;
}

export async function recordSupportHeartbeatIfDue(
  app: FastifyInstance,
  customerId: string,
  deviceId: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const ticket = await getOrCreatePresenceTicket(app, customerId, deviceId);
  const [last] = await app.db
    .select({ createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(and(eq(supportMessages.ticketId, ticket.id), eq(supportMessages.authorKind, 'system')))
    .orderBy(desc(supportMessages.createdAt))
    .limit(1);

  const elapsed = last ? Date.now() - last.createdAt.getTime() : HEARTBEAT_INTERVAL_MS;
  if (elapsed < HEARTBEAT_INTERVAL_MS) return;

  const stamp = new Date().toLocaleString('az-AZ', { timeZone: 'Asia/Baku' });
  await insertMessage(
    app,
    ticket.id,
    'system',
    `POS aktiv — ${stamp}`,
    { meta: { ...meta, heartbeat: true }, touchCustomer: false },
  );
}

/**
 * Machine state the till sends with a support request.
 *
 * Stored on the message so the office sees WHAT is wrong before answering —
 * version, licence state, whether the core is alive, how far behind sync is.
 * Previously a request arrived as a bare sentence and every conversation began
 * with the same four questions.
 */
export type SupportDiagnostics = Record<string, unknown>;

export async function openSupportRequest(
  app: FastifyInstance,
  customerId: string,
  deviceId: string | null,
  message: string,
  source: string,
  diagnostics?: SupportDiagnostics,
): Promise<{ ticket: SupportTicket; message: SupportMessage; created: boolean }> {
  const now = new Date();
  const trimmed = message.trim() || 'Ofis dəstək istəyir';

  const [openTicket] = await app.db
    .select()
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.customerId, customerId),
        eq(supportTickets.kind, 'chat'),
        inArray(supportTickets.status, ['open', 'claimed']),
      ),
    )
    .orderBy(desc(supportTickets.updatedAt))
    .limit(1);

  let ticket = openTicket;
  let created = false;

  if (!ticket) {
    const [row] = await app.db
      .insert(supportTickets)
      .values({
        customerId,
        deviceId: deviceId || null,
        kind: 'chat',
        status: 'open',
        priority: 'urgent',
        subject: 'Ofis dəstək sorğusu',
        lastMessageAt: now,
        lastCustomerAt: now,
      })
      .returning();
    ticket = row!;
    created = true;
  } else {
    await app.db
      .update(supportTickets)
      .set({
        deviceId: deviceId || null,
        priority: 'urgent',
        status: ticket.status === 'resolved' ? 'open' : ticket.status,
        updatedAt: now,
        lastMessageAt: now,
        lastCustomerAt: now,
      })
      .where(eq(supportTickets.id, ticket.id));
    ticket = { ...ticket, priority: 'urgent', lastCustomerAt: now };
  }

  const msg = await insertMessage(app, ticket.id, 'customer', trimmed, {
    meta: diagnostics ? { source, diagnostics } : { source },
    touchCustomer: true,
  });

  // Notify on a re-opened ticket too, not just a brand-new one: a shop that
  // ever contacted support keeps the same chat ticket, so gating on `created`
  // meant their second-ever request reached nobody.
  const shouldNotify=shouldNotifyForTicket(ticket.id);
  if (created || shouldNotify) {
    const customer = await customerBrief(app, customerId);
    await app.db.execute(sql`INSERT INTO support_email_queue(ticket_id,payload) VALUES(${ticket.id}::uuid,${JSON.stringify({
      businessName: customer?.name ?? 'Müştəri',
      contactPerson: customer?.contactPerson,
      phone: customer?.phone,
      email: customer?.email,
      address: customer?.address,
      message: trimmed,
      source,
      ticketId: ticket.id,
      diagnostics: diagnostics ?? null,
    })}::jsonb) ON CONFLICT(ticket_id) WHERE delivered_at IS NULL DO UPDATE SET payload=excluded.payload`);
  }

  return { ticket, message: msg, created };
}

/**
 * Streams a support attachment to the till that owns the ticket.
 *
 * The join on ticket.customerId is the whole point: an attachment id is a bare
 * uuid travelling to a device, so without it any till could fetch any shop's
 * file. Missing bytes answer 410 rather than 500 — a pruned file is expected.
 */
export async function sendSupportAttachmentForCustomer(
  app: FastifyInstance,
  reply: FastifyReply,
  attachmentId: string,
  customerId: string,
) {
  const [row] = await app.db
    .select({
      id: supportAttachments.id,
      fileName: supportAttachments.fileName,
      mimeType: supportAttachments.mimeType,
      sizeBytes: supportAttachments.sizeBytes,
    })
    .from(supportAttachments)
    .innerJoin(supportTickets, eq(supportTickets.id, supportAttachments.ticketId))
    .where(and(eq(supportAttachments.id, attachmentId), eq(supportTickets.customerId, customerId)))
    .limit(1);
  if (!row) return reply.code(404).send({ error: 'Fayl tapılmadı' });

  const file = path.join(env.supportUploadDir, path.basename(row.id));
  if (!existsSync(file)) return reply.code(410).send({ error: 'Fayl artıq mövcud deyil' });
  const mime = row.mimeType || 'application/octet-stream';
  const inline = mime.startsWith('image/') || mime === 'application/pdf';
  reply.header('content-type', mime);
  reply.header('x-content-type-options', 'nosniff');
  reply.header('content-length', String(row.sizeBytes));
  reply.header(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
  );
  return reply.send(createReadStream(file));
}

export async function listChatTickets(app: FastifyInstance, statusFilter?: string) {
  const where =
    statusFilter && statusFilter !== 'all'
      ? and(eq(supportTickets.kind, 'chat'), eq(supportTickets.status, statusFilter))
      : eq(supportTickets.kind, 'chat');

  const rows = await app.db
    .select({
      ticket: supportTickets,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
    })
    .from(supportTickets)
    .innerJoin(customers, eq(customers.id, supportTickets.customerId))
    .where(where)
    .orderBy(desc(supportTickets.lastMessageAt))
    .limit(200);

  const [openCount] = await app.db
    .select({ count: sql<number>`count(*)::int` })
    .from(supportTickets)
    .where(and(eq(supportTickets.kind, 'chat'), eq(supportTickets.status, 'open')));

  return {
    entries: rows.map((row) =>
      serializeTicket(row.ticket, {
        name: row.customerName,
        email: row.customerEmail,
        phone: row.customerPhone,
      }),
    ),
    openCount: openCount?.count ?? 0,
  };
}

export async function getTicketMessages(
  app: FastifyInstance,
  ticketId: string,
  after?: Date,
) {
  const rows = after
    ? await app.db
        .select()
        .from(supportMessages)
        .where(and(eq(supportMessages.ticketId, ticketId), gt(supportMessages.createdAt, after)))
        .orderBy(supportMessages.createdAt)
        .limit(500)
    : await app.db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.ticketId, ticketId))
        .orderBy(supportMessages.createdAt)
        .limit(500);

  return rows.map(serializeMessage);
}

export async function claimTicket(app: FastifyInstance, ticketId: string, adminUserId: string) {
  const now = new Date();
  const [updated] = await app.db
    .update(supportTickets)
    .set({
      status: 'claimed',
      claimedBy: adminUserId,
      claimedAt: now,
      updatedAt: now,
    })
    // isNull(claimedBy) makes claiming a one-shot: without it a second agent
    // silently took over a colleague's ticket and re-posted the "admin accepted"
    // system line, so the shop saw one confused voice answering them.
    .where(
      and(
        eq(supportTickets.id, ticketId),
        eq(supportTickets.kind, 'chat'),
        isNull(supportTickets.claimedBy),
      ),
    )
    .returning();

  if (!updated) return null;

  await insertMessage(
    app,
    ticketId,
    'system',
    'Admin sorğuyu qəbul etdi — canlı mesajlaşma başladı.',
    { authorUserId: adminUserId },
  );

  return updated;
}

export async function postAdminMessage(
  app: FastifyInstance,
  ticketId: string,
  adminUserId: string,
  body: string,
  /** Extra message metadata, e.g. the attachment handle for a sent file. */
  meta?: Record<string, unknown>,
) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const [ticket] = await app.db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!ticket || ticket.kind !== 'chat') return null;

  const message = await insertMessage(app, ticketId, 'admin', trimmed, {
    authorUserId: adminUserId,
    meta,
  });

  if (ticket.status === 'open') {
    await app.db
      .update(supportTickets)
      .set({ status: 'claimed', claimedBy: adminUserId, claimedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));
  }

  // Tell the customer. Without this the reply sat in the portal until they
  // happened to look — support answered at 18:00 and was read next week.
  // createOwnerNotification already fans out to email and web push.
  void createOwnerNotification(app, {
    customerId: ticket.customerId,
    kind: 'support_reply',
    title: 'Dəstək cavab verdi',
    body: trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed,
    payload: { ticketId },
  }).catch((err: unknown) => {
    app.log.warn({ err, ticketId }, 'support_reply_notify_failed');
  });

  return message;
}

/**
 * Per-ticket cooldown on staff notification emails.
 *
 * Notifying only on ticket creation meant a customer writing into an existing
 * ticket — the normal case once a shop has ever contacted support — reached
 * nobody: no email, no badge, and the admin list only polls while a ticket is
 * already open. Messages sat unread for days. Every message now notifies, but
 * throttled so a burst of typing is one email, not ten.
 */
const NOTIFY_COOLDOWN_MS = 5 * 60_000;
const lastNotifiedAt = new Map<string, number>();

function shouldNotifyForTicket(ticketId: string): boolean {
  const now = Date.now();
  const previous = lastNotifiedAt.get(ticketId) ?? 0;
  if (now - previous < NOTIFY_COOLDOWN_MS) return false;
  lastNotifiedAt.set(ticketId, now);
  // ponytail: in-process map, so each API instance notifies at most once per
  // window. Move to a column on support_tickets if this ever runs multi-node.
  if (lastNotifiedAt.size > 5000) lastNotifiedAt.clear();
  return true;
}

export async function postCustomerMessage(
  app: FastifyInstance,
  customerId: string,
  ticketId: string,
  body: string,
  source = 'portal',
  extraMeta?: Record<string, unknown>,
) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const [ticket] = await app.db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.customerId, customerId)))
    .limit(1);
  if (!ticket || ticket.kind !== 'chat') return null;

  const message = await insertMessage(app, ticketId, 'customer', trimmed, {
    meta: { source, ...extraMeta },
    touchCustomer: true,
  });

  if (shouldNotifyForTicket(ticketId)) {
    const customer = await customerBrief(app, customerId);
    await app.db.execute(sql`INSERT INTO support_email_queue(ticket_id,payload) VALUES(${ticketId}::uuid,${JSON.stringify({
      businessName: customer?.name ?? 'Müştəri',
      contactPerson: customer?.contactPerson,
      phone: customer?.phone,
      email: customer?.email,
      address: customer?.address,
      message: trimmed,
      source,
      ticketId,
    })}::jsonb) ON CONFLICT(ticket_id) WHERE delivered_at IS NULL DO UPDATE SET payload=excluded.payload`);
  }

  return message;
}

export async function getActiveChatTicket(app: FastifyInstance, customerId: string) {
  const [ticket] = await app.db
    .select()
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.customerId, customerId),
        eq(supportTickets.kind, 'chat'),
        inArray(supportTickets.status, ['open', 'claimed']),
      ),
    )
    .orderBy(desc(supportTickets.updatedAt))
    .limit(1);

  return ticket ?? null;
}

export async function resolveTicket(app: FastifyInstance, ticketId: string, adminUserId: string) {
  const now = new Date();
  const [updated] = await app.db
    .update(supportTickets)
    .set({ status: 'resolved', updatedAt: now })
    .where(eq(supportTickets.id, ticketId))
    .returning();

  if (!updated) return null;

  await insertMessage(app, ticketId, 'system', 'Sorğu həll edildi.', {
    authorUserId: adminUserId,
  });

  return updated;
}
