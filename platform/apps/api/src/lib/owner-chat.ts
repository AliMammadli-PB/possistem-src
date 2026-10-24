/**
 * Persist portal chat turns for the phone bot UI.
 *
 * The bot engine itself is shared with WhatsApp; this layer only stores what
 * the owner typed and what the bot answered so the transcript survives reload.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { ownerChatMessages } from '@milioner/database';
import type { FastifyInstance } from 'fastify';

export type ChatRole = 'user' | 'bot' | 'system';

export type ChatMessageDto = {
  id: string;
  role: ChatRole;
  body: string;
  clientMessageId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
};

function toDto(row: typeof ownerChatMessages.$inferSelect): ChatMessageDto {
  return {
    id: row.id,
    role: row.role as ChatRole,
    body: row.body,
    clientMessageId: row.clientMessageId,
    meta: (row.meta ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listChatMessages(
  app: FastifyInstance,
  customerId: string,
  opts: { limit?: number; after?: string | null } = {},
): Promise<ChatMessageDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const after = opts.after?.trim() || null;

  if (after) {
    const rows = await app.db
      .select()
      .from(ownerChatMessages)
      .where(
        and(
          eq(ownerChatMessages.customerId, customerId),
          gt(ownerChatMessages.createdAt, new Date(after)),
        ),
      )
      .orderBy(asc(ownerChatMessages.createdAt))
      .limit(limit);
    return rows.map(toDto);
  }

  const rows = await app.db
    .select()
    .from(ownerChatMessages)
    .where(eq(ownerChatMessages.customerId, customerId))
    .orderBy(desc(ownerChatMessages.createdAt))
    .limit(limit);
  return rows.reverse().map(toDto);
}

export async function appendChatMessage(
  app: FastifyInstance,
  input: {
    customerId: string;
    role: ChatRole;
    body: string;
    clientMessageId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<ChatMessageDto> {
  if (input.clientMessageId) {
    const [existing] = await app.db
      .select()
      .from(ownerChatMessages)
      .where(
        and(
          eq(ownerChatMessages.customerId, input.customerId),
          eq(ownerChatMessages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1);
    if (existing) return toDto(existing);
  }

  const [row] = await app.db
    .insert(ownerChatMessages)
    .values({
      customerId: input.customerId,
      role: input.role,
      body: input.body,
      clientMessageId: input.clientMessageId ?? null,
      meta: input.meta ?? {},
    })
    .returning();

  if (!row) throw new Error('Failed to persist chat message');
  return toDto(row);
}

export async function ensureChatWelcome(
  app: FastifyInstance,
  customerId: string,
  adminName: string,
): Promise<void> {
  const [countRow] = await app.db
    .select({ count: sql<number>`count(*)::int` })
    .from(ownerChatMessages)
    .where(eq(ownerChatMessages.customerId, customerId));
  if ((countRow?.count ?? 0) > 0) return;

  const name = adminName?.trim() || 'Admin';
  await appendChatMessage(app, {
    customerId,
    role: 'bot',
    body: [
      `Salam, *${name}*. Bu sizin restoran botunuzdur.`,
      '',
      'Buradan kassanı idarə edə bilərsiniz — WhatsApp-dakı eyni əmrlər:',
      '• *X HESABAT* — günün cari hesabatı',
      '• *Z HESABAT* — günü bağla (təsdiq kodu ilə)',
      '• *MASALAR* — açıq masalar',
      '• *SATIŞ* / *ÜMUMİ* / *STATUS*',
      '• *SON HESABAT* — son X/Z',
      '• *KÖMƏK* — bütün əmrlər',
      '',
      'Aşağıdakı düymələrdən birinə basın və ya özünüz yazın.',
    ].join('\n'),
    meta: { kind: 'welcome' },
  });
}
