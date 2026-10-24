import { startSupportDispatcher } from './lib/support-dispatch.js';
import { eq } from 'drizzle-orm';
import { ownerWhatsappSettings } from '@milioner/database';
import { env } from './env.js';
import { buildApp } from './app.js';
import { restoreWhatsappSessions } from './lib/whatsapp.js';
import { initLiveSchema } from './lib/mysql.js';
import { registerBot } from './lib/bot/index.js';
import { startAlertSweep } from './lib/alerts.js';

async function main() {
  const app = await buildApp();
  try {
    startSupportDispatcher(app);
    await app.listen({ host: env.host, port: env.port });
    app.log.info(
      `POSSISTEM POS Control API listening on http://${env.host}:${env.port}/pos/api (insecureTransport=${env.insecureTransport})`,
    );

    // The live mirror is the bot's only data source, so its tables are created
    // before any till is allowed to sync into them.
    await initLiveSchema(app.log);

    // Inbound WhatsApp must be wired before sessions come back, or a message
    // arriving during restore would land with no handler.
    registerBot(app);
    startAlertSweep(app);

    try {
      const rows = await app.db
        .select({ id: ownerWhatsappSettings.customerId })
        .from(ownerWhatsappSettings)
        .where(eq(ownerWhatsappSettings.waStatus, 'connected'));
      void restoreWhatsappSessions(rows.map((r) => r.id)).catch((err) => {
        app.log.warn({ err }, 'whatsapp_restore_failed');
      });
    } catch (err) {
      app.log.warn({ err }, 'whatsapp_restore_query_failed');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
