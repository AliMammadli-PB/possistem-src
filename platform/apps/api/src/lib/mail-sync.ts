import { sql } from 'drizzle-orm';
import { mailInboxMessages, type Db } from '@milioner/database';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../env.js';
import { imapConfigured, listMailProfiles, matchMailProfile } from './mail-profiles.js';

const SYNC_LIMIT = 120;

type ImapModules = {
  ImapFlow: typeof import('imapflow').ImapFlow;
  simpleParser: typeof import('mailparser').simpleParser;
};

let imapModules: ImapModules | null | undefined;

async function loadImapModules(log: FastifyBaseLogger): Promise<ImapModules | null> {
  if (imapModules !== undefined) return imapModules;
  try {
    const [imapflow, mailparser] = await Promise.all([import('imapflow'), import('mailparser')]);
    imapModules = { ImapFlow: imapflow.ImapFlow, simpleParser: mailparser.simpleParser };
    return imapModules;
  } catch (err) {
    log.warn({ err }, 'mail_imap_modules_missing');
    imapModules = null;
    return null;
  }
}

function previewFromText(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function formatAddressList(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && 'address' in entry) {
          const name = 'name' in entry && entry.name ? `${entry.name} ` : '';
          return `${name}<${String(entry.address)}>`;
        }
        return '';
      })
      .filter(Boolean)
      .join(', ');
  }
  return String(value);
}

function headerToText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  return formatAddressList(value);
}

export async function syncMailInbox(db: Db, log: FastifyBaseLogger): Promise<number> {
  if (!imapConfigured()) {
    log.debug('mail_sync_skipped_no_imap');
    return 0;
  }

  const mods = await loadImapModules(log);
  if (!mods) return 0;

  const profiles = listMailProfiles();
  const client = new mods.ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: env.imapSecure,
    auth: {
      user: env.imapUser,
      pass: env.imapPass,
    },
    logger: false,
  });

  let synced = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const exists = client.mailbox && 'exists' in client.mailbox ? client.mailbox.exists : 0;
      if (!exists) return 0;

      const startUid = Math.max(1, exists - SYNC_LIMIT + 1);
      const range = `${startUid}:*`;

      for await (const msg of client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
        internalDate: true,
      })) {
        if (!msg.source) continue;

        let parsed;
        try {
          parsed = await mods.simpleParser(msg.source);
        } catch (err) {
          log.warn({ err, uid: msg.uid }, 'mail_parse_failed');
          continue;
        }

        const toAddresses = formatAddressList(parsed.to);
        const deliveredTo = headerToText(parsed.headers.get('delivered-to'));

        const profile = matchMailProfile(toAddresses, deliveredTo, profiles);
        const fromAddress =
          parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? 'unknown@unknown';
        const fromName = parsed.from?.value?.[0]?.name ?? null;
        const subject = parsed.subject?.trim() ?? '(Mövzusuz)';
        const bodyText = parsed.text?.trim() ?? '';
        const bodyHtml = typeof parsed.html === 'string' ? parsed.html : null;
        const preview = previewFromText(bodyText || parsed.textAsHtml || subject);
        const receivedAt = new Date(parsed.date ?? msg.internalDate ?? Date.now());
        const messageId = parsed.messageId?.trim() || null;

        const row = {
          profileId: profile.id,
          imapUid: msg.uid ?? null,
          messageId,
          fromAddress,
          fromName,
          toAddresses: toAddresses || profile.email,
          subject,
          preview,
          bodyText: bodyText || null,
          bodyHtml,
          receivedAt,
          syncedAt: new Date(),
        };

        if (messageId) {
          await db
            .insert(mailInboxMessages)
            .values(row)
            .onConflictDoUpdate({
              target: mailInboxMessages.messageId,
              set: {
                preview: row.preview,
                bodyText: row.bodyText,
                bodyHtml: row.bodyHtml,
                syncedAt: row.syncedAt,
              },
            });
        } else {
          await db
            .insert(mailInboxMessages)
            .values(row)
            .onConflictDoUpdate({
              target: [mailInboxMessages.profileId, mailInboxMessages.imapUid],
              set: {
                preview: row.preview,
                bodyText: row.bodyText,
                bodyHtml: row.bodyHtml,
                syncedAt: row.syncedAt,
              },
            });
        }
        synced += 1;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    log.warn({ err }, 'mail_sync_failed');
  }

  if (synced > 0) {
    log.info({ synced }, 'mail_sync_ok');
  }
  return synced;
}

let syncRunning = false;

export function startMailSync(db: Db, log: FastifyBaseLogger): void {
  const tick = () => {
    if (syncRunning) return;
    syncRunning = true;
    void syncMailInbox(db, log)
      .catch((err) => log.warn({ err }, 'mail_sync_tick_failed'))
      .finally(() => {
        syncRunning = false;
      });
  };

  tick();
  setInterval(tick, Math.max(30, env.mailSyncIntervalSec) * 1000);
}

export async function mailSyncStatus(db: Db): Promise<{ configured: boolean; lastSyncedAt: string | null }> {
  const configured = imapConfigured();
  if (!configured) return { configured: false, lastSyncedAt: null };

  const rows = await db
    .select({ syncedAt: mailInboxMessages.syncedAt })
    .from(mailInboxMessages)
    .orderBy(sql`${mailInboxMessages.syncedAt} desc`)
    .limit(1);

  return {
    configured: true,
    lastSyncedAt: rows[0]?.syncedAt?.toISOString() ?? null,
  };
}
