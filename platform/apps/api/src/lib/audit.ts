import type { FastifyInstance } from 'fastify';
import { auditLogs } from '@milioner/database';

export async function writeAudit(
  app: FastifyInstance,
  opts: {
    actorUserId?: string | null;
    actorCustomerId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    meta?: Record<string, unknown>;
    ip?: string | null;
  },
) {
  await app.db.insert(auditLogs).values({
    actorUserId: opts.actorUserId ?? null,
    actorCustomerId: opts.actorCustomerId ?? null,
    action: opts.action,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    meta: opts.meta ?? {},
    ip: opts.ip ?? null,
  });
}
