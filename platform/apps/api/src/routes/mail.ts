import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { mailInboxMessages } from '@milioner/database';
import { getMailProfile, listMailProfiles } from '../lib/mail-profiles.js';
import {
  grantProfileUnlock,
  isProfileUnlocked,
  verifyProfileViewPassword,
} from '../lib/mail-unlock.js';
import { mailSyncStatus, syncMailInbox } from '../lib/mail-sync.js';

function requireAdmin(req: { user: { id: string; role: string } | null }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!req.user || req.user.role !== 'superadmin') {
    reply.code(403).send({ error: 'forbidden' });
    return false;
  }
  return true;
}

function publicMessageRow(
  row: typeof mailInboxMessages.$inferSelect,
  unlocked: boolean,
) {
  const profile = getMailProfile(row.profileId);
  const locked = profile?.protected && !unlocked;
  return {
    id: row.id,
    profileId: row.profileId,
    profileLabel: profile?.label ?? row.profileId,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    toAddresses: row.toAddresses,
    subject: row.subject,
    preview: locked ? null : row.preview,
    bodyText: locked ? null : row.bodyText,
    bodyHtml: locked ? null : row.bodyHtml,
    receivedAt: row.receivedAt.toISOString(),
    protected: Boolean(profile?.protected),
    locked,
  };
}

export async function mailAdminRoutes(app: FastifyInstance) {
  app.get('/mail/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const status = await mailSyncStatus(app.db);
    return reply.send(status);
  });

  app.get('/mail/profiles', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const profiles = listMailProfiles();
    const counts = await app.db
      .select({
        profileId: mailInboxMessages.profileId,
        count: sql<number>`count(*)::int`,
      })
      .from(mailInboxMessages)
      .groupBy(mailInboxMessages.profileId);

    const countMap = new Map(counts.map((c) => [c.profileId, c.count]));
    const userId = req.user!.id;

    return reply.send({
      profiles: profiles.map((p) => ({
        id: p.id,
        label: p.label,
        email: p.email,
        protected: p.protected,
        count: countMap.get(p.id) ?? 0,
        unlocked: isProfileUnlocked(userId, p.id),
      })),
    });
  });

  app.get<{ Querystring: { profile?: string; since?: string } }>(
    '/mail/messages',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const userId = req.user!.id;
      const profileFilter = req.query.profile?.trim();
      const since = req.query.since?.trim();

      const conditions = [];
      if (profileFilter && profileFilter !== 'all') {
        conditions.push(eq(mailInboxMessages.profileId, profileFilter));
      }
      if (since) {
        const sinceDate = new Date(since);
        if (!Number.isNaN(sinceDate.getTime())) {
          conditions.push(gt(mailInboxMessages.receivedAt, sinceDate));
        }
      }

      const rows = await app.db
        .select()
        .from(mailInboxMessages)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mailInboxMessages.receivedAt))
        .limit(300);

      return reply.send({
        entries: rows.map((row) =>
          publicMessageRow(row, isProfileUnlocked(userId, row.profileId)),
        ),
      });
    },
  );

  app.get<{ Params: { id: string } }>('/mail/messages/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const userId = req.user!.id;
    const rows = await app.db
      .select()
      .from(mailInboxMessages)
      .where(eq(mailInboxMessages.id, req.params.id))
      .limit(1);
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const unlocked = isProfileUnlocked(userId, row.profileId);
    const payload = publicMessageRow(row, unlocked);
    if (payload.locked) {
      return reply.code(403).send({ error: 'locked', message: payload });
    }
    return reply.send({ message: payload });
  });

  app.post<{ Body: { profileId?: string; password?: string } }>(
    '/mail/unlock',
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const profileId = String(req.body?.profileId ?? '').trim();
      const password = String(req.body?.password ?? '');
      const profile = getMailProfile(profileId);
      if (!profile) return reply.code(404).send({ error: 'profile_not_found' });
      if (!profile.protected) {
        return reply.send({ ok: true, profileId });
      }
      if (!verifyProfileViewPassword(profileId, password)) {
        return reply.code(401).send({ error: 'wrong_password' });
      }
      grantProfileUnlock(req.user!.id, profileId);
      return reply.send({ ok: true, profileId });
    },
  );

  app.post('/mail/sync', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const synced = await syncMailInbox(app.db, app.log);
    const status = await mailSyncStatus(app.db);
    return reply.send({ synced, ...status });
  });
}
