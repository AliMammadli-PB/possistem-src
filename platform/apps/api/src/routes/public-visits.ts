import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';

let ready: Promise<void> | null = null;

function ensureTable(app: FastifyInstance) {
  ready ??= app.db
    .execute(sql`
      CREATE TABLE IF NOT EXISTS site_visits (
        id bigserial PRIMARY KEY,
        ip text NOT NULL,
        path text NOT NULL DEFAULT '/',
        seen_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    .then(() =>
      app.db.execute(sql`CREATE INDEX IF NOT EXISTS site_visits_seen_idx ON site_visits (seen_at DESC)`),
    )
    .then(() => undefined);
  return ready;
}

function isPublicIp(ip: string): boolean {
  const v = ip.trim().replace(/^::ffff:/i, '');
  if (!v || v === '::1' || v === '0.0.0.0') return false;
  if (v.startsWith('10.') || v.startsWith('127.') || v.startsWith('192.168.') || v.startsWith('169.254.')) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return false;
  if (/^(fc|fd|fe80)/i.test(v)) return false;
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || v.includes(':');
}

/** Real visitor address. Nginx/Cloudflare put it in front of the socket. */
function publicIp(req: FastifyRequest): string | null {
  const cf = req.headers['cf-connecting-ip'];
  const real = req.headers['x-real-ip'];
  const fwd = req.headers['x-forwarded-for'];
  const candidates = [
    typeof cf === 'string' ? cf : '',
    typeof real === 'string' ? real : '',
    typeof fwd === 'string' ? fwd.split(',')[0] : '',
    req.ip || '',
  ];
  for (const raw of candidates) {
    const ip = raw.trim().replace(/^::ffff:/i, '');
    if (isPublicIp(ip)) return ip;
  }
  return null;
}

function asRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

export async function publicVisitRoutes(app: FastifyInstance) {
  app.post('/public/visits', async (req) => {
    await ensureTable(app);
    const ip = publicIp(req);
    const body = req.body as { path?: unknown } | undefined;
    const path = String(body?.path || '/').slice(0, 80).replace(/[^\w./-]/g, '') || '/';
    const ua = String(req.headers['user-agent'] || '');
    const bot = /bot|spider|crawler|preview|headless/i.test(ua);
    if (ip && !bot) {
      await app.db.execute(sql`
        INSERT INTO site_visits (ip, path)
        SELECT ${ip}, ${path}
        WHERE NOT EXISTS (
          SELECT 1 FROM site_visits
          WHERE ip = ${ip} AND seen_at > now() - interval '30 minutes'
        )
      `);
    }
    const totals = asRows(await app.db.execute(sql`
      SELECT
        (SELECT count(DISTINCT ip)::int FROM site_visits) AS total,
        (SELECT count(DISTINCT ip)::int FROM site_visits
          WHERE seen_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku')
        ) AS today
    `));
    const recent = asRows(await app.db.execute(sql`
      SELECT ip, max(seen_at) AS "seenAt"
      FROM site_visits
      WHERE seen_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Baku') AT TIME ZONE 'Asia/Baku')
      GROUP BY ip
      ORDER BY max(seen_at) DESC
      LIMIT 8
    `));
    return {
      total: Number(totals[0]?.total || 0),
      today: Number(totals[0]?.today || 0),
      recent: recent.map((row) => ({
        ip: String(row.ip || ''),
        seenAt: row.seenAt instanceof Date ? row.seenAt.toISOString() : String(row.seenAt || ''),
      })),
    };
  });
}
