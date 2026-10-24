/**
 * Wires inbound WhatsApp messages to the bot.
 *
 * Everything about *who is allowed to speak* lives here: the socket layer only
 * knows how to receive, and the command layer assumes the sender has already
 * been vetted.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ownerWhatsappSettings } from '@milioner/database';
import {
  getLidMap,
  getPhoneForLid,
  learnLidsFor,
  normalizePhone,
  onIncomingWhatsapp,
  seedLidMap,
  sendWhatsappJid,
  sendWhatsappText,
} from '../whatsapp.js';
import { handleBotMessage, type BotSettings } from './commands.js';

/** Per sender, so one runaway phone cannot drive the till in a loop. */
const RATE_LIMIT = { max: 20, windowMs: 60_000 };
const senderHits = new Map<string, number[]>();
/** Unknown-number reports to the owner, at most one every five minutes. */
const strangerNotified = new Map<string, number>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (senderHits.get(key) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  hits.push(now);
  senderHits.set(key, hits);
  return hits.length > RATE_LIMIT.max;
}

function readPermissions(raw: unknown): BotSettings['permissions'] {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    read: value.read !== false,
    reports: value.reports !== false,
    catalog: value.catalog === true,
    alerts: value.alerts !== false,
  };
}

/** The recipient plus any extra numbers the owner listed, all normalised. */
function allowList(row: {
  recipientPhone: string | null;
  allowedNumbers: unknown;
}): string[] {
  const extras = Array.isArray(row.allowedNumbers) ? row.allowedNumbers : [];
  return [row.recipientPhone, ...extras]
    .map((value) => (typeof value === 'string' ? normalizePhone(value) : null))
    .filter((value): value is string => Boolean(value));
}

/**
 * Turns whatever the message carried into a phone number.
 *
 * WhatsApp hides the number behind an @lid, so a sender may arrive with no
 * phone at all. The directory lookup is only paid for when the map cannot
 * already answer.
 */
async function resolveSender(
  customerId: string,
  from: string | null,
  lid: string | null,
  allowed: string[],
): Promise<string | null> {
  if (from) return from;
  if (!lid) return null;

  const known = getPhoneForLid(customerId, lid);
  if (known) return known;

  await learnLidsFor(customerId, allowed);
  return getPhoneForLid(customerId, lid);
}

/**
 * Writes the map back when it has grown, so a restart still knows the owner.
 *
 * Pairs arrive from the directory, from contact syncs and from messages that
 * happen to carry both halves, so the check is against the stored value rather
 * than against any one of those sources.
 */
async function persistLidMap(
  app: FastifyInstance,
  customerId: string,
  stored: unknown,
): Promise<void> {
  const current = getLidMap(customerId);
  if (JSON.stringify(current) === JSON.stringify(stored ?? {})) return;
  try {
    await app.db
      .update(ownerWhatsappSettings)
      .set({ lidMap: current })
      .where(eq(ownerWhatsappSettings.customerId, customerId));
  } catch (err) {
    app.log.warn({ err, customerId }, 'bot_lid_map_persist_failed');
  }
}

/**
 * Answers on the surest address available.
 *
 * Baileys 6.7.18 understands `@lid` when decoding but not when sending, so a
 * reply addressed to a lid may never leave. Once the sender is named, the
 * phone jid is used — the same path the working test message takes. The
 * incoming jid is only a fallback for a sender we could not name at all.
 */
function replyTo(
  customerId: string,
  sender: string | null,
  replyJid: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  return sender
    ? sendWhatsappText(customerId, sender, text)
    : sendWhatsappJid(customerId, replyJid, text);
}

export function registerBot(app: FastifyInstance): void {
  onIncomingWhatsapp(async ({ customerId, from, lid, replyJid, text, pushName }) => {
    const [row] = await app.db
      .select()
      .from(ownerWhatsappSettings)
      .where(eq(ownerWhatsappSettings.customerId, customerId))
      .limit(1);

    if (!row) return;

    seedLidMap(customerId, row.lidMap);
    const allowed = allowList(row);
    const sender = await resolveSender(customerId, from, lid, allowed);
    await persistLidMap(app, customerId, row.lidMap);

    if (!sender || !allowed.includes(sender)) {
      app.log.info({ customerId, from: sender, lid }, 'bot_message_from_stranger');
      const strangerKey = `${customerId}:${sender ?? lid}`;
      const last = strangerNotified.get(strangerKey) ?? 0;
      if (Date.now() - last > 600_000) {
        strangerNotified.set(strangerKey, Date.now());
        // Tell the writer immediately — silent rejection feels like a broken bot.
        await replyTo(
          customerId,
          sender,
          replyJid,
          [
            '🔒 Bu nömrədən əmr qəbul edilmir.',
            '',
            'Kassada *Parametrlər → WhatsApp* bölməsində',
            '"Mesaj alacaq telefon" sahəsinə öz nömrənizi yazın',
            '(məs: 994501234567) və *Yadda saxla* basın.',
          ].join('\n'),
        ).catch(() => undefined);
        // Only report a sender we could actually name. A bare @lid told the
        // owner their own number was a stranger, which is worse than silence.
        if (sender && row.recipientPhone && normalizePhone(row.recipientPhone) !== sender) {
          await sendWhatsappText(
            customerId,
            row.recipientPhone,
            [
              '⚠️ *Naməlum nömrə bota yazdı*',
              '',
              `Nömrə: +${sender}`,
              pushName ? `Ad: ${pushName}` : null,
              '',
              'Cavab verilmədi. İcazə: Parametrlər → WhatsApp → İcazəli nömrələr.',
            ]
              .filter((line) => line !== null)
              .join('\n'),
          ).catch(() => undefined);
        }
      }
      return;
    }

    if (rateLimited(`${customerId}:${sender}`)) {
      app.log.warn({ customerId }, 'bot_rate_limited');
      return;
    }

    const settings: BotSettings = {
      botEnabled: row.botEnabled !== false,
      permissions: readPermissions(row.botPermissions),
      adminName: row.adminName || 'Admin',
    };

    const send = async (message: string) => {
      const result = await replyTo(customerId, sender, replyJid, message);
      if (!result.ok) app.log.warn({ customerId, error: result.error }, 'bot_reply_failed');
    };

    try {
      await handleBotMessage({ app, customerId, from: sender, settings, send }, text);
    } catch (err) {
      app.log.error({ err, customerId }, 'bot_command_failed');
      await send('❌ Gözlənilməz xəta baş verdi. Bir azdan yenidən yoxlayın.').catch(
        () => undefined,
      );
    }
  });

  app.log.info('whatsapp_bot_registered');
}
