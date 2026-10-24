import { existsSync, createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod/v3';
import { currentUser, requireSuperadmin } from '../plugins/auth.js';
import { resolveTenantToken } from './tenant.js';
import { clientIp, parseBody } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import {
  claimTicket,
  getActiveChatTicket,
  getTicketMessages,
  listChatTickets,
  openSupportRequest,
  postAdminMessage,
  postCustomerMessage,
  resolveTicket,
  sendSupportAttachmentForCustomer,
  serializeMessage,
  serializeTicket,
} from '../lib/support.js';
import { customers, supportAttachments, supportTickets } from '@milioner/database';
import { env } from '../env.js';
import { accountLines, adjustOwnedStock, summaryPdf } from '../lib/support-summary.js';
import { and, eq, sql } from 'drizzle-orm';

/** An unparseable ?after= became `Invalid Date` and threw inside gt(). */
function parseAfter(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Postgres throws on a malformed uuid, which would surface as a 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 64 MB: a remote-access installer fits, a disk image does not. */
const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;
const MAX_CUSTOMER_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Trust file bytes over the browser's claimed type so a JPEG is not served as text. */
function sniffedMime(buffer: Buffer, claimed: string, fileName: string): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  const head = buffer.subarray(0, 12).toString('ascii');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('%PDF-')) return 'application/pdf';
  const ext = path.extname(fileName).toLowerCase();
  if (['.txt', '.log', '.json', '.zip'].includes(ext)) return claimed || 'application/octet-stream';
  return null;
}

/**
 * Streams an attachment. `Content-Disposition` carries the original name while
 * the path on disk stays the row id, so a crafted filename cannot escape the
 * upload directory.
 */
function sendAttachment(
  reply: FastifyReply,
  row: { id: string; fileName: string; mimeType: string; sizeBytes: number },
) {
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

const TicketStatusSchema = z.object({
  status: z.enum(['open', 'claimed', 'resolved']),
});

const PostMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export async function supportAdminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/support/tickets', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const status =
      typeof req.query.status === 'string' && req.query.status.length > 0
        ? req.query.status
        : 'all';
    if (/Dalvik/i.test(req.headers['user-agent']??'')) return {entries:[],openCount:0,upgradeRequired:true};
    return listChatTickets(app, status);
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/support/tickets/:id',
    async (req, reply) => {
      if (!requireSuperadmin(req, reply)) return;
      if (!UUID_RE.test(req.params.id)) {
        return reply.code(404).send({ error: 'Sorğu tapılmadı' });
      }

      const [row] = await app.db
        .select({
          ticket: supportTickets,
          customerName: customers.name,
          customerEmail: customers.email,
          customerPhone: customers.phone,
        })
        .from(supportTickets)
        .innerJoin(customers, eq(customers.id, supportTickets.customerId))
        .where(eq(supportTickets.id, req.params.id))
        .limit(1);

      if (!row) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

      const messages = await getTicketMessages(app, req.params.id, parseAfter(req.query.after));

      return {
        ticket: serializeTicket(row.ticket, {
          name: row.customerName,
          email: row.customerEmail,
          phone: row.customerPhone,
        }),
        messages,
      };
    },
  );

  app.post<{ Params: { id: string } }>('/support/tickets/:id/claim', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const user = currentUser(req);
    const updated = await claimTicket(app, req.params.id, user.id);
    if (!updated) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    const device=String(req.headers['x-support-device']??'');
    if(UUID_RE.test(device))await app.db.execute(sql`UPDATE support_dispatch_jobs SET status='accepted',device_id=${device}::uuid,acknowledged_version=version,expires_at=NULL,updated_at=now() WHERE source_type='ticket' AND source_id=${updated.id}::uuid AND EXISTS(SELECT 1 FROM support_staff_devices WHERE id=${device}::uuid AND user_id=${user.id}::uuid)`);
    await writeAudit(app, {
      actorUserId: user.id,
      action: 'support.claim',
      entityType: 'support_ticket',
      entityId: updated.id,
      ip: clientIp(req),
    });

    return { ok: true, ticketId: updated.id, status: updated.status };
  });

  app.post<{ Params: { id: string } }>('/support/tickets/:id/messages', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(PostMessageSchema, req.body, reply);
    if (!body) return;

    const user = currentUser(req);
    const message = await postAdminMessage(app, req.params.id, user.id, body.body);
    if (!message) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    return serializeMessage(message);
  });

  app.patch<{ Params: { id: string } }>('/support/tickets/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(TicketStatusSchema, req.body, reply);
    if (!body) return;

    const user = currentUser(req);
    if (body.status === 'resolved') {
      const updated = await resolveTicket(app, req.params.id, user.id);
      if (!updated) return reply.code(404).send({ error: 'Sorğu tapılmadı' });
      return { ok: true, status: updated.status };
    }

    const [updated] = await app.db
      .update(supportTickets)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(supportTickets.id, req.params.id))
      .returning();

    if (!updated) return reply.code(404).send({ error: 'Sorğu tapılmadı' });
    return { ok: true, status: updated.status };
  });

  /**
   * Staff attaches a file to a ticket (a tool, a driver, a corrected config).
   *
   * Stored on disk named by the row id, never by the uploaded name: the name is
   * attacker-influenced text and must not reach a filesystem path. The file is
   * announced as an ordinary chat message so the shop sees it in the thread and
   * the existing reply notification tells them about it.
   */
  app.post<{ Params: { id: string } }>('/support/tickets/:id/attachments', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    if (!UUID_RE.test(req.params.id)) {
      return reply.code(404).send({ error: 'Sorğu tapılmadı' });
    }

    const [ticket] = await app.db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.id, req.params.id))
      .limit(1);
    if (!ticket) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Fayl seçilməyib' });

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of part.file) {
      total += chunk.length;
      if (total > MAX_ATTACHMENT_BYTES || part.file.truncated) {
        return reply.code(413).send({ error: 'Fayl 64 MB limitini keçir.' });
      }
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) return reply.code(400).send({ error: 'Fayl boşdur' });

    // Keep only the base name, and only for display.
    const fileName = path.basename(String(part.filename ?? 'file')).slice(0, 200) || 'file';
    const sniffed = sniffedMime(buffer, part.mimetype || '', fileName);
    const user = currentUser(req);

    const [row] = await app.db
      .insert(supportAttachments)
      .values({
        ticketId: ticket.id,
        fileName,
        mimeType: sniffed || part.mimetype || 'application/octet-stream',
        sizeBytes: buffer.length,
        uploadedByUserId: user.id,
      })
      .returning();
    if (!row) return reply.code(500).send({ error: 'Fayl qeyd olunmadı' });

    await mkdir(env.supportUploadDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(env.supportUploadDir, row.id), buffer, { mode: 0o600, flag: 'wx' });

    // The message is what the till renders; meta carries the download handle.
    const message = await postAdminMessage(
      app,
      ticket.id,
      user.id,
      `📎 ${fileName}`,
      { attachment: { id: row.id, fileName, sizeBytes: buffer.length, mimeType: sniffed || row.mimeType } },
    );

    await writeAudit(app, {
      actorUserId: user.id,
      action: 'support.attachment.upload',
      entityType: 'support_attachment',
      entityId: row.id,
      ip: clientIp(req),
      meta: { ticketId: ticket.id, fileName, sizeBytes: buffer.length },
    });

    return reply.code(201).send({
      attachment: { id: row.id, fileName, sizeBytes: buffer.length, mimeType: row.mimeType },
      message: message ? serializeMessage(message) : null,
    });
  });

  /** Staff downloads it back (to confirm what was sent). */
  app.get<{ Params: { id: string } }>('/support/attachments/:id', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'Fayl tapılmadı' });
    const [row] = await app.db
      .select()
      .from(supportAttachments)
      .where(eq(supportAttachments.id, req.params.id))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'Fayl tapılmadı' });
    return sendAttachment(reply, row);
  });
}

/**
 * The support chat's customer side: the portal's session cookie, or MarketPos's
 * tenant token (Bearer) so the till's "Texniki dəstək" chat reaches the same
 * ticket the console and the support APK answer.
 */
async function supportCustomer(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; name: string; email: string; source: string } | null> {
  if (req.customer) {
    return { id: req.customer.id, name: req.customer.name, email: req.customer.email, source: 'owner_portal' };
  }
  const auth = req.headers.authorization;
  const token =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined;
  const tenant = resolveTenantToken(token);
  if (!tenant) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  const [row] = await app.db
    .select({ name: customers.name, email: customers.email, active: customers.active })
    .from(customers)
    .where(eq(customers.id, tenant.customerId))
    .limit(1);
  if (!row || !row.active) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  return { id: tenant.customerId, name: row.name, email: row.email ?? tenant.email, source: 'market_pos' };
}

export async function supportCustomerRoutes(app: FastifyInstance) {
  app.get('/customer/support/active', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;

    const ticket = await getActiveChatTicket(app, customer.id);
    if (!ticket) return { ticket: null, messages: [] };

    const messages = await getTicketMessages(app, ticket.id);
    const [customerRow] = await app.db
      .select({ name: customers.name, email: customers.email, phone: customers.phone })
      .from(customers)
      .where(eq(customers.id, customer.id))
      .limit(1);

    return {
      ticket: serializeTicket(ticket, {
        name: customerRow?.name ?? customer.name,
        email: customerRow?.email ?? customer.email,
        phone: customerRow?.phone ?? null,
      }),
      messages,
    };
  });

  app.post('/customer/support/request', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;

    const body = parseBody(
      z.object({ message: z.string().max(4000).optional() }).passthrough(),
      req.body,
      reply,
    );
    if (!body) return;

    const { ticket, message, created } = await openSupportRequest(
      app,
      customer.id,
      null,
      body.message?.trim() || (customer.source === 'market_pos' ? 'Market POS-dan dəstək sorğusu' : 'Müştəri portalından dəstək sorğusu'),
      customer.source,
    );

    return reply.code(created ? 201 : 200).send({
      ticket: serializeTicket(ticket, { name: customer.name, email: customer.email, phone: null }),
      message: serializeMessage(message),
    });
  });

  app.post<{ Params: { id: string } }>('/customer/support/tickets/:id/messages', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;

    const body = parseBody(PostMessageSchema, req.body, reply);
    if (!body) return;

    const message = await postCustomerMessage(
      app,
      customer.id,
      req.params.id,
      body.body,
      customer.source,
    );
    if (!message) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    return serializeMessage(message);
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/customer/support/tickets/:id/messages',
    async (req, reply) => {
      const customer = await supportCustomer(app, req, reply);
      if (!customer) return;

      // getTicketMessages filters by ticket id alone — correct for the admin
      // route above, but here the id comes from the caller, so the ticket must
      // be proven to belong to THIS customer first. Without this any logged-in
      // customer can read another restaurant's whole support conversation.
      if (!UUID_RE.test(req.params.id)) {
        return reply.code(404).send({ error: 'Sorğu tapılmadı' });
      }
      const [owned] = await app.db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(
          and(eq(supportTickets.id, req.params.id), eq(supportTickets.customerId, customer.id)),
        )
        .limit(1);
      if (!owned) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

      const messages = await getTicketMessages(app, req.params.id, parseAfter(req.query.after));
      return { messages };
    },
  );

  app.get('/customer/support/summary', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;
    const query = req.query as { format?: string; intent?: string };
    const format = query.format === 'pdf' ? 'pdf' : 'json';
    const intent = String(query.intent || 'earn:today').slice(0, 80);
    const lines = await accountLines(app, customer.id, intent).catch(() => ['Hesab məlumatını indi oxuya bilmədim. Kassanın serverə son məlumatı çatmayıb ola bilər.']);
    if (format === 'pdf') {
      const pdf = await summaryPdf(lines);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'inline; filename="possistem-hesabat.pdf"');
      return reply.send(pdf);
    }
    return { text: lines.join('\n') };
  });

  app.post('/customer/support/adjust', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;
    const body = parseBody(z.object({
      password: z.string().min(1).max(200),
      query: z.string().trim().min(2).max(40),
      qty: z.number().int().min(0).max(1_000_000),
    }), req.body, reply);
    if (!body) return;
    const text = await adjustOwnedStock(app, customer.id, body.query, body.qty, body.password);
    if (text.startsWith('Şifrə düzgün deyil')) return reply.code(400).send({ error: text });
    await writeAudit(app, { actorCustomerId: customer.id, action: 'customer.chat_stock_adjust', entityType: 'market_product', meta: { query: body.query, qty: body.qty }, ip: clientIp(req) });
    return { text };
  });

  app.get<{ Params: { id: string } }>('/customer/support/attachments/:id', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'Fayl tapılmadı' });
    return sendSupportAttachmentForCustomer(app, reply, req.params.id, customer.id);
  });

  app.post<{ Params: { id: string } }>('/customer/support/tickets/:id/attachments', async (req, reply) => {
    const customer = await supportCustomer(app, req, reply);
    if (!customer) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(404).send({ error: 'Sorğu tapılmadı' });
    const [ticket] = await app.db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, req.params.id), eq(supportTickets.customerId, customer.id), eq(supportTickets.kind, 'chat')))
      .limit(1);
    if (!ticket) return reply.code(404).send({ error: 'Sorğu tapılmadı' });

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Fayl seçilməyib' });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of part.file) {
      total += chunk.length;
      if (total > MAX_CUSTOMER_ATTACHMENT_BYTES || part.file.truncated) {
        return reply.code(413).send({ error: 'Fayl 15 MB limitini keçir.' });
      }
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return reply.code(400).send({ error: 'Fayl boşdur' });
    const fileName = path.basename(String(part.filename ?? 'file')).slice(0, 200) || 'file';
    const mime = sniffedMime(buffer, part.mimetype || '', fileName);
    if (!mime) return reply.code(415).send({ error: 'Şəkil, PDF, ZIP, LOG, TXT və ya JSON göndərin.' });

    const [row] = await app.db.insert(supportAttachments).values({
      ticketId: ticket.id,
      fileName,
      mimeType: mime,
      sizeBytes: buffer.length,
    }).returning();
    if (!row) return reply.code(500).send({ error: 'Fayl qeyd olunmadı' });
    await mkdir(env.supportUploadDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(env.supportUploadDir, row.id), buffer, { mode: 0o600, flag: 'wx' });
    const message = await postCustomerMessage(app, customer.id, ticket.id, `📎 ${fileName}`, customer.source, {
      attachment: { id: row.id, fileName, sizeBytes: buffer.length, mimeType: mime },
    });
    return reply.code(201).send({
      attachment: { id: row.id, fileName, sizeBytes: buffer.length, mimeType: mime },
      message: message ? serializeMessage(message) : null,
    });
  });
}
