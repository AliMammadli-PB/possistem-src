import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { gamecenterAgents, gamecenterPcCommands, gamecenterPcs } from '@milioner/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';

const DEFAULT_PC_COUNT = 67;
const STALE_AFTER_MS = 2 * 60 * 1000;
const COMMAND_RETRY_AFTER_MS = 10_000;
/** An agent that stopped heartbeating cannot shut itself down any more. */
const AGENT_ONLINE_MS = 30_000;
/** After this the main PC takes over with the weaker `shutdown /m` fallback. */
const REMOTE_FALLBACK_AFTER_MS = 6_000;
/** A pending command must never block the one-pending-per-PC index forever. */
const COMMAND_EXPIRY_MS = 2 * 60 * 1000;
/** A main agent that went quiet this long may be replaced by whoever reports in. */
const MAIN_STALE_MS = 3 * 60 * 1000;
const MAC_PATTERN = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const MANIFEST_FILE = 'monitor-latest.json';
const SETUP_NAME_PATTERN = /^OfflineGameCenter-PC-Monitor-Setup-[0-9]+\.[0-9]+\.[0-9]+\.exe$/;

const PcScanSchema = z.object({
  id: z.number().int().min(1).max(999),
  name: z.string().trim().min(1).max(64),
  ip: z.string().trim().ip({ version: 'v4' }),
  reachable: z.boolean(),
  latencyMs: z.number().int().min(0).max(60_000).nullable().optional(),
  mac: z.string().trim().regex(MAC_PATTERN).nullable().optional(),
});

const ScanPayloadSchema = z.object({
  source: z.string().trim().min(1).max(64).default('gamecenter-scanner'),
  mode: z.literal('reachable_means_occupied').default('reachable_means_occupied'),
  checkedAt: z.string().datetime({ offset: true }).optional(),
  pcs: z.array(PcScanSchema).min(1).max(200),
});

const CommandResultSchema = z.object({
  success: z.boolean(),
  message: z.string().trim().max(500).optional(),
});

const HeartbeatSchema = z.object({
  hostname: z.string().trim().max(64).default(''),
  ip: z.string().trim().ip({ version: 'v4' }),
  mac: z.string().trim().regex(MAC_PATTERN).nullable().optional(),
  version: z.string().trim().max(32).default(''),
  os: z.string().trim().max(128).nullable().optional(),
  hostConfig: z.string().trim().max(500).nullable().optional(),
  /**
   * Setup chooses this once: client = game PC (self-shutdown only),
   * main/server = scanner PC (LAN ping + Wake-on-LAN).
   */
  preferredRole: z.enum(['main', 'client', 'server']).optional(),
});

const UpdateResultSchema = z.object({
  ip: z.string().trim().ip({ version: 'v4' }),
  fromVersion: z.string().trim().max(32).default(''),
  toVersion: z.string().trim().max(32).default(''),
  ok: z.boolean(),
  error: z.string().trim().max(300).nullable().optional(),
});

type MonitorManifest = {
  version: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  releasedAt: string | null;
  mandatory: boolean;
};

async function readMonitorManifest(): Promise<MonitorManifest | null> {
  try {
    const raw = await readFile(path.join(env.gamecenterDownloadDir, MANIFEST_FILE), 'utf8');
    const parsed = z
      .object({
        version: z.string().trim().min(1).max(32),
        fileName: z.string().trim().min(1).max(120),
        sha256: z.string().trim().regex(/^[0-9a-f]{64}$/i),
        sizeBytes: z.number().int().positive(),
        releasedAt: z.string().trim().nullable().optional(),
        mandatory: z.boolean().optional(),
      })
      .safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      version: parsed.data.version,
      fileName: parsed.data.fileName,
      sha256: parsed.data.sha256.toLowerCase(),
      sizeBytes: parsed.data.sizeBytes,
      releasedAt: parsed.data.releasedAt ?? null,
      mandatory: parsed.data.mandatory ?? true,
    };
  } catch {
    return null;
  }
}

/**
 * Only one command per PC may be pending, so a job nobody executes would block
 * that PC forever. An outdated agent silently ignoring new command types is
 * exactly how that happened before, hence the hard expiry.
 */
async function expireStuckCommands(app: FastifyInstance): Promise<void> {
  await app.db
    .update(gamecenterPcCommands)
    .set({
      status: 'failed',
      result: sql`coalesce(${gamecenterPcCommands.result}, 'Agent əmri icra etmədi (vaxt bitdi)')`,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(gamecenterPcCommands.status, 'pending'),
        lt(gamecenterPcCommands.createdAt, new Date(Date.now() - COMMAND_EXPIRY_MS)),
      ),
    );
}

function agentIpFromRequest(req: FastifyRequest): string | null {
  const header = req.headers['x-gamecenter-agent-ip'];
  const raw =
    typeof header === 'string'
      ? header
      : typeof (req.query as { agentIp?: unknown } | undefined)?.agentIp === 'string'
        ? ((req.query as { agentIp?: string }).agentIp as string)
        : '';
  const value = raw.trim();
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) ? value : null;
}

type PublicPc = {
  id: number;
  name: string;
  /** 1 = occupied/active, 0 = available/empty, null = unknown/stale */
  active: 0 | 1 | null;
  status: 'available' | 'occupied' | 'unknown';
  latencyMs: number | null;
};

function constantTimeEqual(value: string, expected: string): boolean {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestToken(req: FastifyRequest): string {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  const header = req.headers['x-gamecenter-token'];
  return typeof header === 'string' ? header.trim() : '';
}

function scannerAuthorized(req: FastifyRequest): boolean {
  if (!env.gamecenterMonitorToken) return false;
  const token = requestToken(req);
  return Boolean(token) && constantTimeEqual(token, env.gamecenterMonitorToken);
}

function adminUser(req: FastifyRequest): string | null {
  const user = req.headers['x-gamecenter-admin-user'];
  return typeof user === 'string' && user === 'pandaa' ? user : null;
}

function validAdminOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  return origin === 'https://offlinegame.az' || origin === 'https://www.offlinegame.az';
}

function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac || !MAC_PATTERN.test(mac)) return null;
  return mac.replace(/:/g, '-').toUpperCase();
}

function broadcastFor(ip: string): string {
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.255` : '192.168.1.255';
}

function publicState(
  rows: Array<{
    id: number;
    name: string;
    active: number;
    latencyMs: number | null;
    checkedAt: Date;
    receivedAt: Date;
  }>,
) {
  const latestCheckedAt = rows.reduce<Date | null>((latest, row) => {
    if (!latest || row.checkedAt > latest) return row.checkedAt;
    return latest;
  }, null);
  const latestReceivedAt = rows.reduce<Date | null>((latest, row) => {
    if (!latest || row.receivedAt > latest) return row.receivedAt;
    return latest;
  }, null);

  const now = Date.now();
  const checkedAtMs = latestCheckedAt?.getTime() ?? 0;
  const stale =
    !latestCheckedAt || !Number.isFinite(checkedAtMs) || now - checkedAtMs > STALE_AFTER_MS;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const highestId = Math.max(DEFAULT_PC_COUNT, ...byId.keys(), 0);
  const pcs: PublicPc[] = [];

  for (let id = 1; id <= highestId; id += 1) {
    const row = byId.get(id);
    if (stale || !row) {
      pcs.push({
        id,
        name: row?.name || `PC-${String(id).padStart(2, '0')}`,
        active: null,
        status: 'unknown',
        latencyMs: null,
      });
      continue;
    }
    const active = row.active === 1 ? 1 : 0;
    pcs.push({
      id,
      name: row.name || `PC-${String(id).padStart(2, '0')}`,
      active,
      status: active === 1 ? 'occupied' : 'available',
      latencyMs: row.latencyMs ?? null,
    });
  }

  const available = pcs.filter((pc) => pc.active === 0).length;
  const occupied = pcs.filter((pc) => pc.active === 1).length;
  const unknown = pcs.length - available - occupied;

  return {
    updatedAt: latestCheckedAt?.toISOString() ?? null,
    receivedAt: latestReceivedAt?.toISOString() ?? null,
    stale,
    semantics: {
      active: { 1: 'occupied', 0: 'available' },
      reachable: 'occupied',
      timeout: 'available',
      note: 'Ping yalnız şəbəkə aktivliyini ölçür. DB-də 1=aktiv/məşğul, 0=boş.',
    },
    summary: { total: pcs.length, available, occupied, unknown },
    pcs,
  };
}

export async function gamecenterRoutes(app: FastifyInstance) {
  app.get(
    '/public/gamecenter/pcs',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (_req, reply) => {
      reply.header('Cache-Control', 'no-store');
      const rows = await app.db
        .select({
          id: gamecenterPcs.id,
          name: gamecenterPcs.name,
          active: gamecenterPcs.active,
          latencyMs: gamecenterPcs.latencyMs,
          checkedAt: gamecenterPcs.checkedAt,
          receivedAt: gamecenterPcs.receivedAt,
        })
        .from(gamecenterPcs)
        .orderBy(asc(gamecenterPcs.id));
      return publicState(rows);
    },
  );

  app.post(
    '/public/gamecenter/pcs',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const parsed = ScanPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid scan payload',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      const checkedAt = new Date(parsed.data.checkedAt ?? Date.now());
      const receivedAt = new Date();
      const source = parsed.data.source;
      const pcs = [...parsed.data.pcs].sort((a, b) => a.id - b.id);

      await app.db.transaction(async (tx) => {
        if (pcs.length === 0) return;
        await tx
          .insert(gamecenterPcs)
          .values(
            pcs.map((pc) => ({
              id: pc.id,
              name: pc.name,
              ip: pc.ip,
              mac: normalizeMac(pc.mac),
              active: pc.reachable ? 1 : 0,
              latencyMs: pc.latencyMs ?? null,
              source,
              checkedAt,
              receivedAt,
              updatedAt: receivedAt,
            })),
          )
          .onConflictDoUpdate({
            target: gamecenterPcs.id,
            set: {
              name: sql`excluded.name`,
              ip: sql`excluded.ip`,
              mac: sql`case
                when excluded.ip <> ${gamecenterPcs.ip} then excluded.mac
                else coalesce(excluded.mac, ${gamecenterPcs.mac})
              end`,
              active: sql`excluded.active`,
              latencyMs: sql`excluded.latency_ms`,
              source: sql`excluded.source`,
              checkedAt: sql`excluded.checked_at`,
              receivedAt: sql`excluded.received_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      });

      const occupied = pcs.filter((pc) => pc.reachable).length;
      req.log.info(
        {
          source,
          count: pcs.length,
          occupied,
          available: pcs.length - occupied,
        },
        'gamecenter_pc_scan_received',
      );

      reply.header('Cache-Control', 'no-store');
      return reply.code(202).send({
        ok: true,
        accepted: pcs.length,
        checkedAt: checkedAt.toISOString(),
        stored: 'database',
      });
    },
  );

  app.get(
    '/public/gamecenter/commands',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const now = Date.now();
      await expireStuckCommands(app);

      const agentIp = agentIpFromRequest(req);
      const [agent] = agentIp
        ? await app.db
            .select()
            .from(gamecenterAgents)
            .where(eq(gamecenterAgents.ip, agentIp))
            .limit(1)
        : [];

      // A PC that is still heartbeating must shut itself down; the main PC only
      // steps in for PCs without a working agent.
      const liveAgents = await app.db
        .select({ pcId: gamecenterAgents.pcId })
        .from(gamecenterAgents)
        .where(gte(gamecenterAgents.lastSeenAt, new Date(now - AGENT_ONLINE_MS)));
      const agentPcIds = new Set(
        liveAgents.map((row) => row.pcId).filter((pcId): pcId is number => pcId !== null),
      );

      // Wake-on-LAN + remote shutdown must reach the scanner PC:
      // - role=main (Server install), or
      // - no agent header (legacy v2 scanner), or
      // - agent has no pc_id (IP outside the game-PC range = scanner box).
      const actsAsMain =
        !agent || agent.role === 'main' || agent.pcId == null;
      const retryBefore = new Date(now - COMMAND_RETRY_AFTER_MS);

      const claimed = await app.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: gamecenterPcCommands.id,
            pcId: gamecenterPcCommands.pcId,
            command: gamecenterPcCommands.command,
            mac: gamecenterPcCommands.mac,
            ip: gamecenterPcCommands.ip,
            createdAt: gamecenterPcCommands.createdAt,
          })
          .from(gamecenterPcCommands)
          .where(
            and(
              eq(gamecenterPcCommands.status, 'pending'),
              or(
                isNull(gamecenterPcCommands.dispatchedAt),
                lt(gamecenterPcCommands.dispatchedAt, retryBefore),
              ),
            ),
          )
          .orderBy(asc(gamecenterPcCommands.createdAt))
          .for('update', { skipLocked: true })
          .limit(20);

        const taken: Array<{ row: (typeof rows)[number]; mode: 'self' | 'remote' }> = [];
        for (const row of rows) {
          if (row.command === 'shutdown') {
            if (agent?.pcId != null && agent.pcId === row.pcId) {
              taken.push({ row, mode: 'self' });
              continue;
            }
            if (agentPcIds.has(row.pcId)) continue;
            if (!actsAsMain) continue;
            if (now - row.createdAt.getTime() < REMOTE_FALLBACK_AFTER_MS) continue;
            taken.push({ row, mode: 'remote' });
            continue;
          }
          // Wake-on-LAN can only come from a PC that is already switched on.
          if (!actsAsMain) continue;
          taken.push({ row, mode: 'remote' });
        }

        for (const { row, mode } of taken) {
          await tx
            .update(gamecenterPcCommands)
            .set({
              dispatchedAt: new Date(),
              attempts: sql`${gamecenterPcCommands.attempts} + 1`,
              mode,
              claimedBy: agent?.id ?? null,
            })
            .where(eq(gamecenterPcCommands.id, row.id));
        }
        return taken;
      });

      reply.header('Cache-Control', 'no-store');
      return {
        commands: claimed.map(({ row, mode }) => ({
          id: row.id,
          type: row.command === 'shutdown' ? ('shutdown' as const) : ('wake' as const),
          mode,
          pcId: row.pcId,
          mac: row.mac,
          ip: row.ip,
          broadcast: broadcastFor(row.ip),
          port: 9,
        })),
        pollAfterSeconds: 3,
      };
    },
  );

  app.post(
    '/public/gamecenter/commands/:id/result',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
      const body = CommandResultSchema.safeParse(req.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: 'Invalid command result' });
      }

      const [updated] = await app.db
        .update(gamecenterPcCommands)
        .set({
          status: body.data.success ? 'completed' : 'failed',
          result:
            body.data.message ||
            (body.data.success ? 'Command completed' : 'Command failed'),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(gamecenterPcCommands.id, params.data.id),
            eq(gamecenterPcCommands.status, 'pending'),
          ),
        )
        .returning({ id: gamecenterPcCommands.id });

      if (!updated) return reply.code(404).send({ error: 'Pending command not found' });
      return { ok: true };
    },
  );

  app.post(
    '/public/gamecenter/agent/heartbeat',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const parsed = HeartbeatSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid heartbeat payload' });

      const seenAt = new Date();
      const [pc] = await app.db
        .select({ id: gamecenterPcs.id, name: gamecenterPcs.name })
        .from(gamecenterPcs)
        .where(eq(gamecenterPcs.ip, parsed.data.ip))
        .limit(1);

      const preferred =
        parsed.data.preferredRole === 'server' || parsed.data.preferredRole === 'main'
          ? 'main'
          : 'client';

      const agent = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(gamecenterAgents)
          .values({
            pcId: pc?.id ?? null,
            hostname: parsed.data.hostname,
            ip: parsed.data.ip,
            mac: normalizeMac(parsed.data.mac),
            version: parsed.data.version,
            role: preferred,
            os: parsed.data.os ?? null,
            hostConfig: parsed.data.hostConfig ?? null,
            lastSeenAt: seenAt,
            updatedAt: seenAt,
          })
          .onConflictDoUpdate({
            target: gamecenterAgents.ip,
            set: {
              pcId: sql`excluded.pc_id`,
              hostname: sql`excluded.hostname`,
              mac: sql`coalesce(excluded.mac, ${gamecenterAgents.mac})`,
              version: sql`excluded.version`,
              os: sql`excluded.os`,
              hostConfig: sql`coalesce(excluded.host_config, ${gamecenterAgents.hostConfig})`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .returning();

        // Numbered game PCs (matched by IP → pc_id) that chose Client stay
        // clients. The scanner PC sits outside 192.168.1.101–167 so it has no
        // pc_id — even if a silent auto-update wrongly stamped role=client, it
        // must still be allowed to become the Server and send Wake-on-LAN.
        const isGamePc = pc?.id != null;
        if (preferred === 'client' && isGamePc) {
          if (row.role === 'client') return row;
          const [demoted] = await tx
            .update(gamecenterAgents)
            .set({ role: 'client', updatedAt: seenAt })
            .where(eq(gamecenterAgents.id, row.id))
            .returning();
          return demoted ?? row;
        }

        const [main] = await tx
          .select()
          .from(gamecenterAgents)
          .where(eq(gamecenterAgents.role, 'main'))
          .limit(1);

        if (main && main.id !== row.id) {
          const stale = seenAt.getTime() - main.lastSeenAt.getTime() > MAIN_STALE_MS;
          if (!stale) {
            if (row.role === 'client') return row;
            const [asClient] = await tx
              .update(gamecenterAgents)
              .set({ role: 'client', updatedAt: seenAt })
              .where(eq(gamecenterAgents.id, row.id))
              .returning();
            return asClient ?? row;
          }
          await tx
            .update(gamecenterAgents)
            .set({ role: 'client', updatedAt: seenAt })
            .where(eq(gamecenterAgents.id, main.id));
        }
        if (main?.id === row.id) return row;

        const [promoted] = await tx
          .update(gamecenterAgents)
          .set({ role: 'main', updatedAt: seenAt })
          .where(eq(gamecenterAgents.id, row.id))
          .returning();
        return promoted ?? row;
      });

      reply.header('Cache-Control', 'no-store');
      return {
        agentId: agent.id,
        pcId: agent.pcId,
        name: pc?.name ?? null,
        role: agent.role,
        pollAfterSeconds: 3,
        heartbeatSeconds: 5,
        updateCheckSeconds: 60,
      };
    },
  );

  app.get(
    '/public/gamecenter/agent/manifest',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const manifest = await readMonitorManifest();
      if (!manifest) return reply.code(404).send({ error: 'Monitor manifest is not published' });

      reply.header('Cache-Control', 'no-store');
      return {
        ...manifest,
        downloadPath: `/pos/api/public/gamecenter/agent/download?version=${encodeURIComponent(
          manifest.version,
        )}`,
      };
    },
  );

  app.get(
    '/public/gamecenter/agent/download',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const manifest = await readMonitorManifest();
      if (!manifest) return reply.code(404).send({ error: 'Monitor manifest is not published' });

      const query = z
        .object({ version: z.string().trim().max(32).optional() })
        .safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'Invalid version' });
      if (query.data.version && query.data.version !== manifest.version) {
        return reply.code(409).send({ error: 'Requested version is no longer published' });
      }
      // The manifest is operator-written; refuse anything that is not a plain
      // versioned setup file name so it can never escape the download folder.
      if (!SETUP_NAME_PATTERN.test(manifest.fileName)) {
        return reply.code(500).send({ error: 'Manifest file name is not allowed' });
      }

      const file = path.join(env.gamecenterDownloadDir, manifest.fileName);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return reply.code(404).send({ error: 'Setup file is missing' });

      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Length', String(info.size));
      reply.header('Content-Disposition', `attachment; filename="${manifest.fileName}"`);
      reply.header('X-Monitor-Sha256', manifest.sha256);
      return reply.type('application/octet-stream').send(createReadStream(file));
    },
  );

  app.post(
    '/public/gamecenter/agent/update-result',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const parsed = UpdateResultSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid update result' });

      const status = parsed.data.ok
        ? `updated ${parsed.data.fromVersion || '?'} → ${parsed.data.toVersion || '?'}`
        : `update failed ${parsed.data.toVersion || '?'}: ${parsed.data.error || 'naməlum xəta'}`;

      await app.db
        .update(gamecenterAgents)
        .set({ updateStatus: status.slice(0, 300), updatedAt: new Date() })
        .where(eq(gamecenterAgents.ip, parsed.data.ip));

      req.log.info(
        { ip: parsed.data.ip, ok: parsed.data.ok, to: parsed.data.toVersion },
        'gamecenter_agent_update_result',
      );
      return { ok: true };
    },
  );

  /**
   * Full LAN floor for agent windows (includes IP). Public site never sees IPs;
   * only the monitor token can read this snapshot so Client PCs can show the
   * same ping grid the Server publishes.
   */
  app.get(
    '/public/gamecenter/agent/floor',
    {
      config: {
        rateLimit: {
          max: 300,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      if (!env.gamecenterMonitorToken) {
        return reply.code(503).send({ error: 'GameCenter monitor token is not configured' });
      }
      if (!scannerAuthorized(req)) {
        return reply.code(401).send({ error: 'Invalid monitor token' });
      }

      const rows = await app.db.select().from(gamecenterPcs).orderBy(asc(gamecenterPcs.id));
      const latestCheckedAt = rows.reduce<Date | null>(
        (latest, row) => (!latest || row.checkedAt > latest ? row.checkedAt : latest),
        null,
      );
      const stale =
        !latestCheckedAt || Date.now() - latestCheckedAt.getTime() > STALE_AFTER_MS;

      reply.header('Cache-Control', 'no-store');
      return {
        updatedAt: latestCheckedAt?.toISOString() ?? null,
        stale,
        summary: {
          total: rows.length,
          occupied: stale ? 0 : rows.filter((row) => row.active === 1).length,
          available: stale ? 0 : rows.filter((row) => row.active !== 1).length,
        },
        pcs: rows.map((row) => ({
          id: row.id,
          name: row.name,
          ip: row.ip,
          mac: row.mac,
          // Same semantics as the scanner: ping reply = occupied, timeout = empty.
          reachable: stale ? false : row.active === 1,
          active: stale ? null : row.active === 1 ? 1 : 0,
          latencyMs: stale ? null : row.latencyMs,
          status: stale ? 'unknown' : row.active === 1 ? 'occupied' : 'available',
        })),
      };
    },
  );

  app.get(
    '/gamecenter-admin/pcs',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const user = adminUser(req);
      if (!user) return reply.code(401).send({ error: 'Admin authentication required' });

      await expireStuckCommands(app);

      const [pcs, recentCommands, agents, manifest] = await Promise.all([
        app.db.select().from(gamecenterPcs).orderBy(asc(gamecenterPcs.id)),
        app.db
          .select()
          .from(gamecenterPcCommands)
          .orderBy(desc(gamecenterPcCommands.createdAt))
          .limit(200),
        app.db.select().from(gamecenterAgents),
        readMonitorManifest(),
      ]);
      const latestCheckedAt = pcs.reduce<Date | null>(
        (latest, pc) => (!latest || pc.checkedAt > latest ? pc.checkedAt : latest),
        null,
      );
      const stale =
        !latestCheckedAt || Date.now() - latestCheckedAt.getTime() > STALE_AFTER_MS;
      const latestCommandByPc = new Map<number, (typeof recentCommands)[number]>();
      for (const command of recentCommands) {
        if (!latestCommandByPc.has(command.pcId)) {
          latestCommandByPc.set(command.pcId, command);
        }
      }
      const agentByPcId = new Map<number, (typeof agents)[number]>();
      for (const agent of agents) {
        if (agent.pcId === null) continue;
        const current = agentByPcId.get(agent.pcId);
        if (!current || agent.lastSeenAt > current.lastSeenAt) {
          agentByPcId.set(agent.pcId, agent);
        }
      }

      const now = Date.now();
      let agentsOnline = 0;

      const payload = pcs.map((pc) => {
        const active = stale ? null : pc.active === 1 ? 1 : 0;
        const lastCommand = latestCommandByPc.get(pc.id);
        const agent = agentByPcId.get(pc.id);
        const agentOnline = Boolean(agent && now - agent.lastSeenAt.getTime() <= AGENT_ONLINE_MS);
        if (agentOnline) agentsOnline += 1;
        return {
          id: pc.id,
          name: pc.name,
          ip: pc.ip,
          mac: pc.mac,
          active,
          status: active === null ? 'unknown' : active === 1 ? 'occupied' : 'available',
          canWake: Boolean(pc.mac),
          canShutdown: Boolean(pc.ip) && active === 1,
          shutdownMode: agentOnline ? ('self' as const) : ('remote' as const),
          agent: agent
            ? {
                online: agentOnline,
                version: agent.version || null,
                role: agent.role,
                lastSeenAt: agent.lastSeenAt.toISOString(),
                updateStatus: agent.updateStatus,
              }
            : null,
          checkedAt: pc.checkedAt.toISOString(),
          lastCommand: lastCommand
            ? {
                id: lastCommand.id,
                command: lastCommand.command,
                mode: lastCommand.mode,
                status: lastCommand.status,
                result: lastCommand.result,
                createdAt: lastCommand.createdAt.toISOString(),
                completedAt: lastCommand.completedAt?.toISOString() ?? null,
              }
            : null,
        };
      });

      reply.header('Cache-Control', 'no-store');
      return {
        updatedAt: latestCheckedAt?.toISOString() ?? null,
        stale,
        agentsOnline,
        latestAgentVersion: manifest?.version ?? null,
        pcs: payload,
      };
    },
  );

  async function queuePcCommand(
    app: FastifyInstance,
    req: FastifyRequest,
    reply: import('fastify').FastifyReply,
    kind: 'wake' | 'shutdown',
  ) {
    const user = adminUser(req);
    if (!user) return reply.code(401).send({ error: 'Admin authentication required' });
    if (!validAdminOrigin(req)) {
      return reply.code(403).send({ error: 'Invalid request origin' });
    }
    const params = z.object({ id: z.coerce.number().int().min(1).max(999) }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid PC id' });

    const [pc] = await app.db
      .select()
      .from(gamecenterPcs)
      .where(eq(gamecenterPcs.id, params.data.id))
      .limit(1);
    if (!pc) return reply.code(404).send({ error: 'PC not found' });
    if (!pc.ip) return reply.code(409).send({ error: 'PC IP address is not known yet' });

    if (kind === 'wake' && !pc.mac) {
      return reply.code(409).send({
        error: 'MAC address is not known yet. Turn the PC on once so the scanner can learn it.',
      });
    }
    if (kind === 'shutdown' && pc.active !== 1) {
      return reply.code(409).send({
        error: 'PC is not online. Shutdown only works while the PC answers ping.',
      });
    }

    const [command] = await app.db
      .insert(gamecenterPcCommands)
      .values({
        pcId: pc.id,
        command: kind,
        mac: pc.mac || '',
        ip: pc.ip,
        requestedBy: user,
      })
      .onConflictDoNothing()
      .returning({ id: gamecenterPcCommands.id });

    if (!command) {
      const [existing] = await app.db
        .select({ id: gamecenterPcCommands.id })
        .from(gamecenterPcCommands)
        .where(
          and(eq(gamecenterPcCommands.pcId, pc.id), eq(gamecenterPcCommands.status, 'pending')),
        )
        .limit(1);
      if (existing) return { ok: true, queued: true, commandId: existing.id };
      return reply.code(409).send({ error: `${kind} command could not be queued` });
    }

    req.log.info(
      { pcId: pc.id, commandId: command.id, user, command: kind },
      kind === 'wake' ? 'gamecenter_wake_queued' : 'gamecenter_shutdown_queued',
    );
    return reply.code(202).send({ ok: true, queued: true, commandId: command.id });
  }

  app.post(
    '/gamecenter-admin/pcs/:id/wake',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => queuePcCommand(app, req, reply, 'wake'),
  );

  app.post(
    '/gamecenter-admin/pcs/:id/shutdown',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => queuePcCommand(app, req, reply, 'shutdown'),
  );
}
