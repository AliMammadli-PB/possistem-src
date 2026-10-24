import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { parseBody } from '../lib/validate.js';
import { requireSuperadmin } from '../plugins/auth.js';

/**
 * Website package builder: the customer ticks the features they want, sets
 * counts (monitors) and names their printers, sees separate monthly and one-time totals and
 * orders over WhatsApp. The superadmin edits every feature, price and text
 * in the admin panel ("Paket qurucusu"); the site reads it on load.
 *
 * One row (id 'site') holding the whole document as jsonb. The table is
 * created here on first use, so deploying needs no separate migration step
 * (migrations/0034_package_builder.sql holds the same statement).
 */

export type { PackageBuilderContent } from '../lib/package-builder-schema.js';
import { PackageBuilderContentSchema as Content, type PackageBuilderContent } from '../lib/package-builder-schema.js';

const L = (az: string, ru: string, en: string) => ({ az, ru, en });

/** First content: the features the business sells; prices are set in the admin panel. */
const DEFAULT_CONTENT: PackageBuilderContent = {
  items: [
    { id: 'kassa', kind: 'base', name: L('Kassa proqramı', 'Кассовая программа', 'POS software'),
      description: L('Lokal baza və lokal hesabatlar — internet olmadan işləyir', 'Локальная база и отчёты — работает без интернета', 'Local database and reports — works offline'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: true, defaultQty: 1, active: true },
    { id: 'cloud', kind: 'toggle', name: L('Bulud baza və backup', 'Облачная база и резервные копии', 'Cloud database & backup'),
      description: L('Məlumatlar həm də serverdə saxlanılır', 'Данные также хранятся на сервере', 'Data is also kept on the server'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: false, defaultQty: 0, active: true },
    { id: 'anbar', kind: 'toggle', name: L('Anbar və stok', 'Склад и остатки', 'Warehouse & stock'),
      description: L('Alış, qalıq, inventarizasiya', 'Закупки, остатки, инвентаризация', 'Purchases, stock levels, stocktake'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: false, defaultQty: 0, active: true },
    { id: 'phone-panel', kind: 'toggle', name: L('Telefonda sahibkar paneli', 'Панель владельца в телефоне', 'Owner panel on the phone'),
      description: L('Satışları və hesabatları telefondan izləyin', 'Продажи и отчёты с телефона', 'Sales and reports from your phone'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: false, defaultQty: 0, active: true },
    { id: 'live-tables', kind: 'toggle', name: L('Canlı masalar', 'Столы онлайн', 'Live tables'),
      description: L('Hansı masada kim oturub, nə sifariş olunub — canlı', 'Кто за каким столом и что заказано — онлайн', 'Who sits where and what was ordered — live'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: false, defaultQty: 0, active: true },
    { id: 'chat', kind: 'toggle', name: L('Chat dəstək', 'Чат-поддержка', 'Chat support'),
      description: L('Proqramın içindən dəstəklə yazışma', 'Переписка с поддержкой прямо из программы', 'Talk to support from inside the app'),
      unit: L('', '', ''), billing: 'monthly', priceMinor: 0, min: 0, max: 1, defaultOn: false, defaultQty: 0, active: true },
    { id: 'monitor', kind: 'quantity', name: L('Monitor (kassa ekranı)', 'Монитор (экран кассы)', 'Monitor (till screen)'),
      description: L('Neçə kassa / ekran işləyəcək', 'Сколько касс / экранов', 'How many tills / screens'),
      unit: L('ədəd', 'шт.', 'pcs'), billing: 'monthly', priceMinor: 0, min: 1, max: 20, defaultOn: true, defaultQty: 1, active: true },
    { id: 'printer', kind: 'printers', name: L('Printer', 'Принтер', 'Printer'),
      description: L('Hər printerə ad verin (Kababçı, Dönərçi…) və harada çap edəcəyini seçin', 'Назовите каждый принтер и выберите, что он печатает', 'Name each printer and choose what it prints'),
      unit: L('ədəd', 'шт.', 'pcs'), billing: 'monthly', priceMinor: 0, min: 0, max: 20, defaultOn: true, defaultQty: 1, active: true },
  ],
  printerTargets: [L('Müştəri çeki', 'Чек клиента', 'Guest receipt'), L('Mətbəx', 'Кухня', 'Kitchen'), L('Anbar', 'Склад', 'Warehouse'), L('Bar', 'Бар', 'Bar')],
  whatsappPhone: '994513333555',
  note: L('', '', ''),
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export async function packageBuilderRoutes(app: FastifyInstance) {
  let ready: Promise<unknown> | null = null;
  const ensureTable = () =>
    (ready ??= app.db.execute(sql`
      CREATE TABLE IF NOT EXISTS package_builder (
        id text PRIMARY KEY,
        content jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).catch((err) => { ready = null; throw err; }));

  const load = async (): Promise<PackageBuilderContent> => {
    await ensureTable();
    const rows = rowsOf<{ content: unknown }>(await app.db.execute(sql`SELECT content FROM package_builder WHERE id = 'site'`));
    const parsed = rows[0] ? Content.safeParse(rows[0].content) : null;
    return parsed?.success ? parsed.data : DEFAULT_CONTENT;
  };

  // Public — the website's package builder.
  app.get('/package-builder', async (_req, reply) => {
    const content = await load();
    reply.header('cache-control', 'no-store');
    return { ...content, items: content.items.filter((i) => i.active) };
  });

  // Admin — the whole document, inactive features included.
  app.get('/admin/package-builder', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    return load();
  });

  app.put('/admin/package-builder', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const body = parseBody(Content, req.body, reply);
    if (!body) return;
    await ensureTable();
    await app.db.execute(sql`
      INSERT INTO package_builder (id, content, updated_at)
      VALUES ('site', ${JSON.stringify(body)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
    `);
    return { ok: true, content: body };
  });
}
