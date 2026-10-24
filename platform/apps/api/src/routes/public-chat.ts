import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { customers, featureFlags } from '@milioner/database';
import { parseBody, clientIp } from '../lib/validate.js';
import { requireSuperadmin, currentUser, requireAuth } from '../plugins/auth.js';
import { writeAudit } from '../lib/audit.js';
import {
  chatAvatarFile,
  chatAvatarUrl,
  removeChatAvatar,
  saveChatAvatar,
} from '../lib/chat-avatar.js';
import { chatUploadFile, looksLikeImage, saveChatUpload } from '../lib/chat-upload.js';

const DEFAULT_COOLDOWN_MINUTES = 10;
const THREAD_PAGE = 30;
const REPLY_PAGE = 50;

const MentionsSchema = z
  .array(
    z.object({
      customerId: z.string().uuid(),
      displayName: z.string().trim().min(1).max(120),
    }),
  )
  .max(10)
  .optional()
  .default([]);

const PostReplySchema = z.object({
  body: z.string().trim().max(4000),
  mentions: MentionsSchema,
}).refine((value) => value.body.length > 0, { message: 'Message required' });

const CreateThreadSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().max(4000),
  mentions: MentionsSchema,
}).refine((value) => value.body.length > 0, { message: 'Message required' });

const CooldownSchema = z.object({
  minutes: z.number().int().min(1).max(1440),
});

type Db = FastifyInstance['db'];

async function getCooldownMinutes(db: Db): Promise<number> {
  const [flag] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, 'public.chat.cooldown_minutes'))
    .limit(1);
  const minutes =
    flag?.payload && typeof flag.payload === 'object'
      ? Number((flag.payload as { minutes?: unknown }).minutes)
      : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_COOLDOWN_MINUTES;
}

function displayName(row: {
  contactPerson: string | null;
  name: string;
  email: string | null;
}): string {
  return row.contactPerson?.trim() || row.name.trim() || row.email || 'Müştəri';
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    customerId: row.customer_id ? String(row.customer_id) : null,
    authorName: String(row.author_name),
    body: String(row.body),
    isStaff: Boolean(row.is_staff),
    avatarUrl:
      row.customer_id && row.chat_avatar_path
        ? chatAvatarUrl(String(row.customer_id))
        : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapThread(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    authorName: String(row.author_name),
    title: String(row.title),
    replyCount: Number(row.reply_count ?? 0),
    lastReplyAt: new Date(String(row.last_reply_at ?? row.created_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    avatarUrl: row.chat_avatar_path && row.customer_id ? chatAvatarUrl(String(row.customer_id)) : null,
    lastPreview: row.last_preview ? String(row.last_preview) : null,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireStaff(
  req: Parameters<typeof requireAuth>[0],
  reply: Parameters<typeof requireAuth>[1],
): boolean {
  if (!requireAuth(req, reply)) return false;
  if (!requireSuperadmin(req, reply)) return false;
  return true;
}

async function assertChatAllowed(
  db: Db,
  customerId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT active, chat_banned_at
    FROM customers
    WHERE id = ${customerId}::uuid
    LIMIT 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row || row.active === false) {
    reply.code(403).send({ error: 'Account inactive' });
    return false;
  }
  if (row.chat_banned_at) {
    reply.code(403).send({ error: 'Chat banned', code: 'CHAT_BANNED' });
    return false;
  }
  return true;
}

async function assertDailyTopicLimit(
  db: Db,
  customerId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM public_chat_threads
    WHERE customer_id = ${customerId}::uuid
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku')
  `);
  const n = Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
  if (n < 1) return true;
  const nextRows = await db.execute(sql`
    SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Baku') + interval '1 day') AT TIME ZONE 'Asia/Baku') AS next_at
  `);
  const nextAt = (nextRows as Array<Record<string, unknown>>)[0]?.next_at;
  reply.code(429).send({
    error: 'Daily topic limit',
    code: 'TOPIC_DAILY_LIMIT',
    nextAt: nextAt ? new Date(String(nextAt)).toISOString() : null,
  });
  return false;
}

async function customerTopicQuota(db: Db, customerId: string): Promise<{
  canCreateTopic: boolean;
  nextTopicAt: string | null;
}> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM public_chat_threads
    WHERE customer_id = ${customerId}::uuid
      AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku')
  `);
  const n = Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
  if (n < 1) return { canCreateTopic: true, nextTopicAt: null };
  const nextRows = await db.execute(sql`
    SELECT ((date_trunc('day', now() AT TIME ZONE 'Asia/Baku') + interval '1 day') AT TIME ZONE 'Asia/Baku') AS next_at
  `);
  const nextAt = (nextRows as Array<Record<string, unknown>>)[0]?.next_at;
  return {
    canCreateTopic: false,
    nextTopicAt: nextAt ? new Date(String(nextAt)).toISOString() : null,
  };
}

async function assertCooldown(
  db: Db,
  customerId: string,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  const cooldownMinutes = await getCooldownMinutes(db);
  const last = await db.execute(sql`
    SELECT created_at FROM public_chat_messages
    WHERE customer_id = ${customerId}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (last[0]?.created_at) {
    const lastAt = new Date(String((last[0] as Record<string, unknown>).created_at)).getTime();
    const remaining = lastAt + cooldownMinutes * 60_000 - Date.now();
    if (remaining > 0) {
      reply.code(429).send({
        error: 'Cooldown active',
        remainingSeconds: Math.ceil(remaining / 1000),
        cooldownMinutes,
      });
      return false;
    }
  }
  return true;
}

async function insertMentions(
  db: Db,
  messageId: string,
  authorCustomerId: string,
  mentions: { customerId: string; displayName: string }[],
) {
  const unique = new Map<string, string>();
  for (const mention of mentions) {
    if (mention.customerId === authorCustomerId) continue;
    unique.set(mention.customerId, mention.displayName);
  }
  for (const [mentionedId] of unique) {
    await db.execute(sql`
      INSERT INTO public_chat_mentions (message_id, mentioned_customer_id, mentioned_by_customer_id)
      VALUES (${messageId}::uuid, ${mentionedId}::uuid, ${authorCustomerId}::uuid)
    `);
  }
}

const MAX_CHAT_IMAGE_BYTES = 12 * 1024 * 1024;

async function savePublicChatImage(
  req: FastifyRequest,
  reply: FastifyReply,
  opts?: { staff?: boolean },
) {
  if (!opts?.staff && !req.customer) {
    if (!requireAuth(req, reply)) return;
    if (!requireSuperadmin(req, reply)) return;
  }
  let file;
  try {
    file = await req.file();
  } catch (error) {
    req.log.warn({ error }, 'chat_upload_multipart_failed');
    return reply.code(400).send({ error: 'File too large (max 12MB)', code: 'FILE_TOO_LARGE' });
  }
  if (!file) return reply.code(400).send({ error: 'No file uploaded' });
  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    req.log.warn({ error }, 'chat_upload_buffer_failed');
    return reply.code(400).send({ error: 'File too large (max 12MB)', code: 'FILE_TOO_LARGE' });
  }
  if (buffer.length > MAX_CHAT_IMAGE_BYTES) {
    return reply.code(400).send({ error: 'File too large (max 12MB)', code: 'FILE_TOO_LARGE' });
  }
  const mime = file.mimetype ?? '';
  const filename = file.filename ?? '';
  if (!looksLikeImage(mime, filename)) {
    return reply.code(400).send({ error: 'Only images allowed', code: 'NOT_IMAGE' });
  }
  try {
    const saved = await saveChatUpload(buffer);
    return { url: saved.url, bytes: saved.bytes };
  } catch (error) {
    req.log.warn({ error, mime, filename }, 'chat_upload_process_failed');
    return reply.code(400).send({ error: 'Invalid image file', code: 'INVALID_IMAGE' });
  }
}

export async function publicChatRoutes(app: FastifyInstance) {
  app.addHook('preHandler',async(req,reply)=>{if(req.method==='GET'&&req.url.startsWith('/pos/api/public/chat/threads')&&req.user&&/Dalvik/i.test(req.headers['user-agent']??''))return reply.send({threads:[],upgradeRequired:true});});
  app.get('/public/chat/config', async () => ({
    cooldownMinutes: await getCooldownMinutes(app.db),
  }));

  app.get('/public/chat/avatars/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[0-9a-f-]{36}\.avif$/i.test(file)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const customerId = file.replace(/\.avif$/i, '');
    try {
      await access(chatAvatarFile(customerId));
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    reply.header('Content-Type', 'image/avif');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(chatAvatarFile(customerId)));
  });

  app.get('/public/chat/uploads/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[0-9a-f-]{36}\.webp$/i.test(file)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const id = file.replace(/\.webp$/i, '');
    try {
      await access(chatUploadFile(id));
    } catch {
      return reply.code(404).send({ error: 'Not found' });
    }
    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(createReadStream(chatUploadFile(id)));
  });

  app.get('/public/chat/participants', async (req, reply) => {
    // This is the @mention directory: it only means anything to a signed-in
    // customer, and it hands out customer ids, so it must not be anonymous.
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const q = typeof req.query === 'object' && req.query && 'q' in req.query ? String(req.query.q) : '';
    const search = q.trim().toLowerCase();
    const rows = await app.db.execute(sql`
      SELECT DISTINCT ON (c.id)
        c.id,
        -- Never fall back to c.email: for a customer with no contact person or
        -- name that published their e-mail address as a display name.
        COALESCE(NULLIF(TRIM(c.contact_person), ''), NULLIF(TRIM(c.name), ''), 'Müştəri') AS label,
        c.chat_avatar_path,
        c.chat_banned_at
      FROM customers c
      INNER JOIN public_chat_messages m ON m.customer_id = c.id
      WHERE c.active = true
      ORDER BY c.id, m.created_at DESC
      LIMIT 80
    `);
    let participants = (rows as Array<Record<string, unknown>>).map((row) => ({
      customerId: String(row.id),
      displayName: String(row.label),
      avatarUrl: row.chat_avatar_path ? chatAvatarUrl(String(row.id)) : null,
      chatBanned: Boolean(row.chat_banned_at),
    }));
    if (search) {
      participants = participants.filter((p) => p.displayName.toLowerCase().includes(search));
    }
    return { participants: participants.slice(0, 20) };
  });

  app.get('/public/chat/threads', async (req) => {
    const before =
      typeof req.query === 'object' && req.query && 'before' in req.query
        ? String(req.query.before)
        : null;
    const limitRaw =
      typeof req.query === 'object' && req.query && 'limit' in req.query
        ? Number(req.query.limit)
        : THREAD_PAGE;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : THREAD_PAGE;

    const rows = before
      ? await app.db.execute(sql`
          SELECT t.*, c.chat_avatar_path, lm.body AS last_preview
          FROM public_chat_threads t
          LEFT JOIN customers c ON c.id = t.customer_id
          LEFT JOIN LATERAL (
            SELECT body FROM public_chat_messages m
            WHERE m.thread_id = t.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ) lm ON TRUE
          WHERE t.last_reply_at < ${before}::timestamptz
          ORDER BY t.last_reply_at DESC
          LIMIT ${limit}
        `)
      : await app.db.execute(sql`
          SELECT t.*, c.chat_avatar_path, lm.body AS last_preview
          FROM public_chat_threads t
          LEFT JOIN customers c ON c.id = t.customer_id
          LEFT JOIN LATERAL (
            SELECT body FROM public_chat_messages m
            WHERE m.thread_id = t.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ) lm ON TRUE
          ORDER BY t.last_reply_at DESC
          LIMIT ${limit}
        `);

    const threads = (rows as Array<Record<string, unknown>>).map(mapThread);
    return {
      threads,
      hasMore: threads.length === limit,
      cooldownMinutes: await getCooldownMinutes(app.db),
    };
  });

  app.get('/public/chat/threads/:id', async (req, reply) => {
    const threadId = (req.params as { id: string }).id;
    if (!isUuid(threadId)) return reply.code(404).send({ error: 'Thread not found' });
    const [threadRow] = await app.db.execute(sql`
      SELECT t.*, c.chat_avatar_path
      FROM public_chat_threads t
      LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.id = ${threadId}::uuid
      LIMIT 1
    `);
    if (!threadRow) return reply.code(404).send({ error: 'Thread not found' });

    // Take the NEWEST page, then flip back to ascending for display. Ordering
    // ASC before the LIMIT returned the oldest 50, so once a thread passed 50
    // replies every new message was stored and never shown to anyone — which
    // reads to users as "chat is broken".
    const msgRows = await app.db.execute(sql`
      SELECT * FROM (
        SELECT m.*, c.chat_avatar_path
        FROM public_chat_messages m
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.thread_id = ${threadId}::uuid
        ORDER BY m.created_at DESC
        LIMIT ${REPLY_PAGE}
      ) AS recent
      ORDER BY recent.created_at ASC
    `);

    return {
      thread: mapThread(threadRow as Record<string, unknown>),
      messages: (msgRows as Array<Record<string, unknown>>).map(mapMessage),
    };
  });

  app.get('/public/chat/mentions', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const rows = await app.db.execute(sql`
      SELECT mn.id, mn.message_id, mn.created_at, m.body, m.author_name, m.customer_id AS author_customer_id,
             t.title AS thread_title, t.id AS thread_id
      FROM public_chat_mentions mn
      INNER JOIN public_chat_messages m ON m.id = mn.message_id
      LEFT JOIN public_chat_threads t ON t.id = m.thread_id
      WHERE mn.mentioned_customer_id = ${req.customer.id} AND mn.read_at IS NULL
      ORDER BY mn.created_at DESC
      LIMIT 30
    `);
    return {
      mentions: (rows as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        messageId: String(row.message_id),
        threadId: row.thread_id ? String(row.thread_id) : null,
        threadTitle: row.thread_title ? String(row.thread_title) : null,
        body: String(row.body),
        authorName: String(row.author_name),
        authorCustomerId: String(row.author_customer_id),
        createdAt: new Date(String(row.created_at)).toISOString(),
      })),
    };
  });

  app.patch('/public/chat/mentions/:id/read', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const mentionId = (req.params as { id: string }).id;
    await app.db.execute(sql`
      UPDATE public_chat_mentions SET read_at = now()
      WHERE id = ${mentionId}::uuid AND mentioned_customer_id = ${req.customer.id} AND read_at IS NULL
    `);
    return { ok: true };
  });

  app.patch('/public/chat/mentions/read-all', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    await app.db.execute(sql`
      UPDATE public_chat_mentions SET read_at = now()
      WHERE mentioned_customer_id = ${req.customer.id} AND read_at IS NULL
    `);
    return { ok: true };
  });

  app.get('/public/chat/cooldown', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const cooldownMinutes = await getCooldownMinutes(app.db);
    const last = await app.db.execute(sql`
      SELECT created_at FROM public_chat_messages
      WHERE customer_id = ${req.customer.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastAt = last[0]?.created_at
      ? new Date(String((last[0] as Record<string, unknown>).created_at)).getTime()
      : null;
    const waitMs = cooldownMinutes * 60_000;
    const canSendAt = lastAt ? lastAt + waitMs : Date.now();
    const remainingMs = Math.max(0, canSendAt - Date.now());
    return {
      cooldownMinutes,
      canSend: remainingMs === 0,
      remainingSeconds: Math.ceil(remainingMs / 1000),
      nextSendAt: remainingMs > 0 ? new Date(canSendAt).toISOString() : null,
    };
  });

  app.get('/public/chat/profile', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    const [customer] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, req.customer.id))
      .limit(1);
    if (!customer) return reply.code(404).send({ error: 'Not found' });
    return {
      customerId: customer.id,
      name: displayName(customer),
      avatarUrl: customer.chatAvatarPath ? chatAvatarUrl(customer.id) : null,
      chatBanned: Boolean(customer.chatBannedAt),
      ...(await customerTopicQuota(app.db, customer.id)),
    };
  });

  app.post(
    '/public/chat/avatar',
    { config: { rateLimit: { max: 8, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });
      const buffer = await file.toBuffer();
      if (buffer.length > 5 * 1024 * 1024) {
        return reply.code(400).send({ error: 'File too large (max 5MB)' });
      }
      const mime = file.mimetype ?? '';
      if (!mime.startsWith('image/')) {
        return reply.code(400).send({ error: 'Only images allowed' });
      }
      try {
        const saved = await saveChatAvatar(req.customer.id, buffer);
        await app.db
          .update(customers)
          .set({ chatAvatarPath: saved.path, updatedAt: new Date() })
          .where(eq(customers.id, req.customer.id));
        return { avatarUrl: chatAvatarUrl(req.customer.id), bytes: saved.bytes };
      } catch {
        return reply.code(400).send({ error: 'Invalid image file' });
      }
    },
  );

  app.post(
    '/public/chat/uploads',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      return savePublicChatImage(req, reply);
    },
  );

  app.post(
    '/public/chat/staff/uploads',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!requireStaff(req, reply)) return;
      return savePublicChatImage(req, reply, { staff: true });
    },
  );

  app.delete('/public/chat/avatar', async (req, reply) => {
    if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
    await removeChatAvatar(req.customer.id);
    await app.db
      .update(customers)
      .set({ chatAvatarPath: null, updatedAt: new Date() })
      .where(eq(customers.id, req.customer.id));
    return { ok: true };
  });

  app.post(
    '/public/chat/threads',
    { config: { rateLimit: { max: 15, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
      const body = parseBody(CreateThreadSchema, req.body, reply);
      if (!body) return;
      if (!(await assertChatAllowed(app.db, req.customer.id, reply))) return;
      if (!(await assertDailyTopicLimit(app.db, req.customer.id, reply))) return;
      if (!(await assertCooldown(app.db, req.customer.id, reply))) return;

      const [customer] = await app.db
        .select()
        .from(customers)
        .where(eq(customers.id, req.customer.id))
        .limit(1);
      if (!customer?.active) return reply.code(403).send({ error: 'Account inactive' });

      const authorName = displayName(customer);
      const threadInsert = await app.db.execute(sql`
        INSERT INTO public_chat_threads (customer_id, author_name, title, reply_count, last_reply_at)
        VALUES (${req.customer.id}, ${authorName}, ${body.title}, 0, now())
        RETURNING id, customer_id, author_name, title, reply_count, last_reply_at, created_at
      `);
      const threadRow = (threadInsert as Array<Record<string, unknown>>)[0];
      if (!threadRow) return reply.code(500).send({ error: 'Thread create failed' });
      const threadId = String(threadRow.id);

      const msgInsert = await app.db.execute(sql`
        INSERT INTO public_chat_messages (thread_id, customer_id, author_name, body, is_staff)
        VALUES (${threadId}::uuid, ${req.customer.id}, ${authorName}, ${body.body}, false)
        RETURNING id, thread_id, customer_id, author_name, body, is_staff, created_at
      `);
      const msgRow = (msgInsert as Array<Record<string, unknown>>)[0];
      if (!msgRow) return reply.code(500).send({ error: 'Message create failed' });

      await insertMentions(app.db, String(msgRow.id), req.customer.id, body.mentions ?? []);

      const avatarUrl = customer.chatAvatarPath ? chatAvatarUrl(customer.id) : null;
      return {
        thread: { ...mapThread({ ...threadRow, chat_avatar_path: customer.chatAvatarPath }), avatarUrl },
        message: {
          ...mapMessage({ ...msgRow, chat_avatar_path: customer.chatAvatarPath }),
          avatarUrl,
        },
      };
    },
  );

  app.post(
    '/public/chat/threads/:id/replies',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
      const threadId = (req.params as { id: string }).id;
      const body = parseBody(PostReplySchema, req.body, reply);
      if (!body) return;
      if (!(await assertChatAllowed(app.db, req.customer.id, reply))) return;
      if (!(await assertCooldown(app.db, req.customer.id, reply))) return;

      const [thread] = await app.db.execute(sql`
        SELECT id FROM public_chat_threads WHERE id = ${threadId}::uuid LIMIT 1
      `);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });

      const [customer] = await app.db
        .select()
        .from(customers)
        .where(eq(customers.id, req.customer.id))
        .limit(1);
      if (!customer?.active) return reply.code(403).send({ error: 'Account inactive' });

      const authorName = displayName(customer);
      const inserted = await app.db.execute(sql`
        INSERT INTO public_chat_messages (thread_id, customer_id, author_name, body, is_staff)
        VALUES (${threadId}::uuid, ${req.customer.id}, ${authorName}, ${body.body}, false)
        RETURNING id, thread_id, customer_id, author_name, body, is_staff, created_at
      `);
      const row = (inserted as Array<Record<string, unknown>>)[0];
      if (!row) return reply.code(500).send({ error: 'Insert failed' });

      await app.db.execute(sql`
        UPDATE public_chat_threads
        SET reply_count = reply_count + 1, last_reply_at = now()
        WHERE id = ${threadId}::uuid
      `);
      await insertMentions(app.db, String(row.id), req.customer.id, body.mentions ?? []);

      return {
        message: {
          ...mapMessage({ ...row, chat_avatar_path: customer.chatAvatarPath }),
          avatarUrl: customer.chatAvatarPath ? chatAvatarUrl(customer.id) : null,
        },
      };
    },
  );

  /** Staff (superadmin) reply — shown in green in the chat UI. */
  app.post(
    '/public/chat/staff/threads/:id/replies',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;
      if (!requireSuperadmin(req, reply)) return;
      const threadId = (req.params as { id: string }).id;
      const body = parseBody(PostReplySchema, req.body, reply);
      if (!body) return;

      const [thread] = await app.db.execute(sql`
        SELECT id FROM public_chat_threads WHERE id = ${threadId}::uuid LIMIT 1
      `);
      if (!thread) return reply.code(404).send({ error: 'Thread not found' });

      const staff = currentUser(req);
      const authorName = staff.email.split('@')[0] || 'possistem';

      const inserted = await app.db.execute(sql`
        INSERT INTO public_chat_messages (thread_id, customer_id, author_name, body, is_staff)
        VALUES (${threadId}::uuid, NULL, ${authorName}, ${body.body}, true)
        RETURNING id, thread_id, customer_id, author_name, body, is_staff, created_at
      `);
      const row = (inserted as Array<Record<string, unknown>>)[0];
      if (!row) return reply.code(500).send({ error: 'Insert failed' });

      await app.db.execute(sql`
        UPDATE public_chat_threads
        SET reply_count = reply_count + 1, last_reply_at = now()
        WHERE id = ${threadId}::uuid
      `);

      return { message: mapMessage(row) };
    },
  );

  app.post(
    '/public/chat/staff/threads',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!requireStaff(req, reply)) return;
      const body = parseBody(CreateThreadSchema, req.body, reply);
      if (!body) return;
      const staff = currentUser(req);
      const authorName = staff.email.split('@')[0] || 'possistem';
      const threadInsert = await app.db.execute(sql`
        INSERT INTO public_chat_threads (customer_id, author_name, title, reply_count, last_reply_at)
        VALUES (NULL, ${authorName}, ${body.title}, 0, now())
        RETURNING id, customer_id, author_name, title, reply_count, last_reply_at, created_at
      `);
      const threadRow = (threadInsert as Array<Record<string, unknown>>)[0];
      if (!threadRow) return reply.code(500).send({ error: 'Thread create failed' });
      const threadId = String(threadRow.id);
      const msgInsert = await app.db.execute(sql`
        INSERT INTO public_chat_messages (thread_id, customer_id, author_name, body, is_staff)
        VALUES (${threadId}::uuid, NULL, ${authorName}, ${body.body}, true)
        RETURNING id, thread_id, customer_id, author_name, body, is_staff, created_at
      `);
      const msgRow = (msgInsert as Array<Record<string, unknown>>)[0];
      if (!msgRow) return reply.code(500).send({ error: 'Message create failed' });
      await writeAudit(app, {
        actorUserId: staff.id,
        action: 'public_chat.staff_thread_create',
        entityType: 'public_chat_thread',
        entityId: threadId,
        ip: clientIp(req),
        meta: { title: body.title },
      });
      return {
        thread: mapThread(threadRow),
        message: mapMessage(msgRow),
      };
    },
  );

  app.delete('/public/chat/staff/threads/:id', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const threadId = (req.params as { id: string }).id;
    if (!isUuid(threadId)) return reply.code(400).send({ error: 'Invalid id' });
    const deleted = await app.db.execute(sql`
      DELETE FROM public_chat_threads WHERE id = ${threadId}::uuid RETURNING id
    `);
    if (!(deleted as Array<Record<string, unknown>>)[0]) {
      return reply.code(404).send({ error: 'Thread not found' });
    }
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'public_chat.thread_delete',
      entityType: 'public_chat_thread',
      entityId: threadId,
      ip: clientIp(req),
    });
    return { ok: true };
  });

  app.delete('/public/chat/staff/messages/:id', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const messageId = (req.params as { id: string }).id;
    if (!isUuid(messageId)) return reply.code(400).send({ error: 'Invalid id' });
    const rows = await app.db.execute(sql`
      DELETE FROM public_chat_messages
      WHERE id = ${messageId}::uuid
      RETURNING id, thread_id
    `);
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return reply.code(404).send({ error: 'Message not found' });
    const threadId = String(row.thread_id);
    await app.db.execute(sql`
      UPDATE public_chat_threads t
      SET
        reply_count = GREATEST(0, (
          SELECT count(*)::int - 1 FROM public_chat_messages m WHERE m.thread_id = t.id
        )),
        last_reply_at = COALESCE(
          (SELECT max(created_at) FROM public_chat_messages m WHERE m.thread_id = t.id),
          t.created_at
        )
      WHERE t.id = ${threadId}::uuid
    `);
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'public_chat.message_delete',
      entityType: 'public_chat_message',
      entityId: messageId,
      ip: clientIp(req),
      meta: { threadId },
    });
    return { ok: true, threadId };
  });

  app.post('/public/chat/staff/customers/:id/ban', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const customerId = (req.params as { id: string }).id;
    if (!isUuid(customerId)) return reply.code(400).send({ error: 'Invalid id' });
    const updated = await app.db.execute(sql`
      UPDATE customers
      SET chat_banned_at = COALESCE(chat_banned_at, now()), updated_at = now()
      WHERE id = ${customerId}::uuid
      RETURNING id, chat_banned_at
    `);
    if (!(updated as Array<Record<string, unknown>>)[0]) {
      return reply.code(404).send({ error: 'Customer not found' });
    }
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'public_chat.customer_ban',
      entityType: 'customer',
      entityId: customerId,
      ip: clientIp(req),
    });
    return { ok: true, chatBanned: true };
  });

  app.delete('/public/chat/staff/customers/:id/ban', async (req, reply) => {
    if (!requireStaff(req, reply)) return;
    const customerId = (req.params as { id: string }).id;
    if (!isUuid(customerId)) return reply.code(400).send({ error: 'Invalid id' });
    const updated = await app.db.execute(sql`
      UPDATE customers
      SET chat_banned_at = NULL, updated_at = now()
      WHERE id = ${customerId}::uuid
      RETURNING id
    `);
    if (!(updated as Array<Record<string, unknown>>)[0]) {
      return reply.code(404).send({ error: 'Customer not found' });
    }
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'public_chat.customer_unban',
      entityType: 'customer',
      entityId: customerId,
      ip: clientIp(req),
    });
    return { ok: true, chatBanned: false };
  });

  // Legacy flat endpoint — creates a thread automatically
  app.post(
    '/public/chat/messages',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (!req.customer) return reply.code(401).send({ error: 'Unauthorized' });
      const body = parseBody(PostReplySchema, req.body, reply);
      if (!body) return;
      const title = body.body.length <= 100 ? body.body : `${body.body.slice(0, 97)}…`;
      req.body = { title, body: body.body, mentions: body.mentions };
      // Delegate to thread creator (same handler logic inline)
      const createBody = parseBody(CreateThreadSchema, req.body, reply);
      if (!createBody) return;
      if (!(await assertChatAllowed(app.db, req.customer.id, reply))) return;
      if (!(await assertDailyTopicLimit(app.db, req.customer.id, reply))) return;
      if (!(await assertCooldown(app.db, req.customer.id, reply))) return;
      const [customer] = await app.db
        .select()
        .from(customers)
        .where(eq(customers.id, req.customer.id))
        .limit(1);
      if (!customer?.active) return reply.code(403).send({ error: 'Account inactive' });
      const authorName = displayName(customer);
      const threadInsert = await app.db.execute(sql`
        INSERT INTO public_chat_threads (customer_id, author_name, title, reply_count, last_reply_at)
        VALUES (${req.customer.id}, ${authorName}, ${createBody.title}, 0, now())
        RETURNING id
      `);
      const threadId = String((threadInsert as Array<Record<string, unknown>>)[0]?.id);
      const msgInsert = await app.db.execute(sql`
        INSERT INTO public_chat_messages (thread_id, customer_id, author_name, body, is_staff)
        VALUES (${threadId}::uuid, ${req.customer.id}, ${authorName}, ${createBody.body}, false)
        RETURNING id, thread_id, customer_id, author_name, body, is_staff, created_at
      `);
      const msgRow = (msgInsert as Array<Record<string, unknown>>)[0];
      if (!msgRow) return reply.code(500).send({ error: 'Insert failed' });
      await insertMentions(app.db, String(msgRow.id), req.customer.id, createBody.mentions ?? []);
      return {
        message: mapMessage({ ...msgRow, chat_avatar_path: customer.chatAvatarPath }),
      };
    },
  );
}

export async function publicChatSettingsRoutes(app: FastifyInstance) {
  app.get('/settings/public-chat-cooldown', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    return { minutes: await getCooldownMinutes(app.db) };
  });

  app.patch('/settings/public-chat-cooldown', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(CooldownSchema, req.body, reply);
    if (!body) return;
    await app.db
      .insert(featureFlags)
      .values({
        key: 'public.chat.cooldown_minutes',
        description: 'Minutes between public chat messages per customer',
        enabled: true,
        scope: 'global',
        payload: { minutes: body.minutes },
      })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { enabled: true, payload: { minutes: body.minutes }, updatedAt: new Date() },
      });
    await writeAudit(app, {
      actorUserId: currentUser(req).id,
      action: 'settings.public_chat_cooldown',
      entityType: 'feature_flag',
      entityId: 'public.chat.cooldown_minutes',
      ip: clientIp(req),
      meta: { minutes: body.minutes },
    });
    return { minutes: body.minutes };
  });
}
