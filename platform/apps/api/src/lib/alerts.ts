/**
 * The one thing the bot says without being asked: your till went quiet.
 *
 * X/Z notifications already ride the report ingest path; this sweep covers the
 * failure the owner cannot see any other way — a POS that stopped syncing
 * because the PC was switched off, the internet dropped, or the app crashed.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ownerWhatsappSettings } from '@milioner/database';
import { isDeviceOnline, listLiveCustomers, mysqlEnabled } from './mysql.js';
import { sendWhatsappText } from './whatsapp.js';

/** Quiet for this long counts as down, not as a slow tick. */
const OFFLINE_AFTER_MS = 5 * 60_000;
const SWEEP_MS = 60_000;

/** Last state we told the owner about, so a flapping link is not a siren. */
const notifiedOffline = new Map<string, boolean>();

let timer: NodeJS.Timeout | null = null;

async function sweep(app: FastifyInstance): Promise<void> {
  const rows = await listLiveCustomers();
  for (const row of rows) {
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (!lastSeen) continue;

    const online = isDeviceOnline(row.last_seen_at, row.connected);
    const quietFor = Date.now() - lastSeen;
    const offline = !online && quietFor > OFFLINE_AFTER_MS;
    const wasOffline = notifiedOffline.get(row.customer_id) ?? false;
    if (offline === wasOffline) continue;

    // A till that has never been seen is not "down", it is unsold.
    if (offline && quietFor > 7 * 24 * 3600_000) {
      notifiedOffline.set(row.customer_id, true);
      continue;
    }

    const [settings] = await app.db
      .select()
      .from(ownerWhatsappSettings)
      .where(eq(ownerWhatsappSettings.customerId, row.customer_id))
      .limit(1);
    notifiedOffline.set(row.customer_id, offline);

    if (!settings?.enabled || !settings.recipientPhone) continue;
    const alerts = (settings.botPermissions as Record<string, boolean> | null)?.alerts;
    if (alerts === false) continue;

    const name = row.restaurant_name ? ` — ${row.restaurant_name}` : '';
    const minutes = Math.round(quietFor / 60_000);
    const text = offline
      ? [
          `🔴 *Kassa oflayndır${name}*`,
          '',
          `Son əlaqə: ${minutes} dəqiqə əvvəl.`,
          'Kompüter söndürülüb və ya internet kəsilib ola bilər.',
        ].join('\n')
      : [`🟢 *Kassa yenidən onlayndır${name}*`, '', 'Məlumat axını bərpa olundu.'].join('\n');

    const result = await sendWhatsappText(row.customer_id, settings.recipientPhone, text);
    if (!result.ok) {
      app.log.warn(
        { customerId: row.customer_id, error: result.error },
        'offline_alert_send_failed',
      );
    } else {
      app.log.info({ customerId: row.customer_id, offline }, 'offline_alert_sent');
    }
  }
}

export function startAlertSweep(app: FastifyInstance): void {
  if (!mysqlEnabled() || timer) return;
  timer = setInterval(() => {
    void sweep(app).catch((err) => app.log.warn({ err }, 'alert_sweep_failed'));
  }, SWEEP_MS);
  timer.unref?.();
  app.log.info('alert_sweep_started');
}

export function stopAlertSweep(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
