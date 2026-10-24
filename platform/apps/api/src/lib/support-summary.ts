import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

const require = createRequire('/opt/possistem-pos-control/apps/api/vendor/pdf/package.json');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

type Row = Record<string, unknown>;
export type BranchLine = { name: string; salesToday: number; updatedAt: string | null };
export type AccountSummary = {
  branches: BranchLine[];
  salesToday: number;
  profitToday: number | null;
  profitAll: number | null;
  stockSaleValue: number | null;
  stockCostValue: number | null;
  updatedAt: string | null;
  empty: boolean;
};

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === 'object' && 'rows' in result) return (result as { rows: Row[] }).rows;
  return [];
}
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function fromPayload(payload: Record<string, unknown>) {
  const products = Array.isArray(payload.products) ? payload.products : [];
  const stats = new Map<string, { today: number; all: number; soldToday: number; soldAll: number }>();
  if (Array.isArray(payload.productStats)) {
    for (const raw of payload.productStats) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Row;
      const id = String(row.id ?? '');
      if (!id) continue;
      stats.set(id, {
        today: Math.max(0, num(row.revenueTodayMinor)),
        all: Math.max(0, num(row.revenueAllMinor)),
        soldToday: Math.max(0, num(row.soldTodayQty)),
        soldAll: Math.max(0, num(row.soldAllQty)),
      });
    }
  }
  let profitToday = 0;
  let profitAll = 0;
  let stockSale = 0;
  let stockCost = 0;
  let costKnown = false;
  let stockKnown = false;
  for (const raw of products) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Row;
    const cost = Math.max(0, num(item.costMinor));
    const price = Math.max(0, num(item.priceMinor));
    const qty = num(item.stock);
    if (item.costMinor != null && Number(item.costMinor) > 0) costKnown = true;
    if (Number.isFinite(qty)) stockKnown = true;
    stockSale += qty * price;
    stockCost += qty * cost;
    const sale = stats.get(String(item.id ?? ''));
    if (!sale) continue;
    profitToday += sale.today - cost * sale.soldToday;
    profitAll += sale.all - cost * sale.soldAll;
  }
  return {
    profitToday: costKnown ? Math.round(profitToday) : null,
    profitAll: costKnown ? Math.round(profitAll) : null,
    stockSaleValue: stockKnown ? Math.round(stockSale) : null,
    stockCostValue: stockKnown && costKnown ? Math.round(stockCost) : null,
  };
}

export type ProductHit = { name: string; qty: number; warehouse: string; barcode: string };

function productName(payload: Record<string, unknown>): string {
  const name = payload.name;
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object' && 'az' in name) return String((name as { az?: unknown }).az ?? '');
  return '';
}

export async function findProducts(app: FastifyInstance, customerId: string, query: string): Promise<ProductHit[]> {
  const needle = query.replace(/[%_]/g, '').trim().slice(0, 40);
  if (needle.length < 2) return [];
  const like = `%${needle}%`;
  const rows = rowsOf(await app.db.execute(sql`
    SELECT p.product_id AS id, p.payload,
           COALESCE(b.warehouse_id, '') AS warehouse,
           COALESCE(b.qty, 0) AS qty,
           COALESCE(w.payload->>'name', b.warehouse_id, '') AS warehouse_name
    FROM market_products p
    LEFT JOIN market_stock_balances b
      ON b.customer_id = p.customer_id AND b.product_id = p.product_id
    LEFT JOIN market_warehouses w
      ON w.customer_id = p.customer_id AND w.warehouse_id = b.warehouse_id
    WHERE p.customer_id = ${customerId}::uuid
      AND (
        lower(COALESCE(p.payload->>'name', '')) LIKE lower(${like})
        OR lower(COALESCE(p.payload#>>'{name,az}', '')) LIKE lower(${like})
        OR lower(COALESCE(p.payload->>'barcode', '')) LIKE lower(${like})
      )
    ORDER BY p.payload->>'name'
    LIMIT 30
  `));
  return rows.map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    const qty = row.warehouse ? num(row.qty) : num(payload.stock);
    return {
      name: productName(payload) || String(row.id ?? needle),
      qty,
      warehouse: String(row.warehouse_name || 'Anbar'),
      barcode: String(payload.barcode ?? ''),
    };
  });
}

export async function loadAccountSummary(app: FastifyInstance, customerId: string): Promise<AccountSummary> {
  const snaps = rowsOf(await app.db.execute(sql`
    SELECT COALESCE(NULLIF(d.hostname, ''), 'Filial') AS name,
           s.daily_sales_minor AS sales,
           s.payload,
           s.updated_at
    FROM market_pos_snapshots s
    LEFT JOIN devices d ON d.id = s.device_id
    WHERE s.customer_id = ${customerId}::uuid
      AND (d.status IS NULL OR d.status <> 'revoked')
    ORDER BY s.updated_at DESC
    LIMIT 40
  `));
  const branches: BranchLine[] = snaps.map((row) => ({
    name: String(row.name || 'Filial'),
    salesToday: Math.max(0, Math.round(num(row.sales))),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  }));
  const latest = snaps[0]?.payload && typeof snaps[0].payload === 'object' ? snaps[0].payload as Record<string, unknown> : null;
  const money = latest ? fromPayload(latest) : { profitToday: null, profitAll: null, stockSaleValue: null, stockCostValue: null };
  let salesToday = branches.reduce((sum, row) => sum + row.salesToday, 0);
  try {
    const floor = rowsOf(await app.db.execute(sql`
      SELECT today_sales_minor AS sales, updated_at FROM owner_floor_snapshots
      WHERE customer_id = ${customerId}::uuid LIMIT 1
    `));
    const restaurant = Math.max(0, Math.round(num(floor[0]?.sales)));
    if (restaurant > 0) {
      branches.push({ name: 'Restoran', salesToday: restaurant, updatedAt: floor[0]?.updated_at ? new Date(String(floor[0].updated_at)).toISOString() : null });
      salesToday += restaurant;
    }
  } catch { /* table may be absent on older hosts */ }
  return {
    branches,
    salesToday,
    ...money,
    updatedAt: snaps[0]?.updated_at ? new Date(String(snaps[0].updated_at)).toISOString() : null,
    empty: branches.length === 0 && money.stockSaleValue == null && money.profitAll == null,
  };
}

export async function accountLines(app: FastifyInstance, customerId: string, intent: string): Promise<string[]> {
  if (intent.startsWith('product:')) {
    const hits = await findProducts(app, customerId, intent.slice(8));
    if (!hits.length) return [`«${intent.slice(8)}» üzrə anbarda məhsul tapılmadı.`, 'Adı satış kartındakı adla eyni yazın, məsələn: cola.'];
    const lines = [`«${intent.slice(8)}» üçün anbar qalığı:`, ''];
    let total = 0;
    for (const hit of hits) {
      total += hit.qty;
      lines.push(`- ${hit.name}${hit.barcode ? ` (${hit.barcode})` : ''}: ${hit.qty} ədəd, ${hit.warehouse}`);
    }
    lines.push('', `Cəmi: ${total} ədəd.`, 'Bu, kassanın serverə yazdığı son qalıqdır.');
    return lines;
  }
  if (intent.startsWith('adjust:')) {
    const [, name, qty] = intent.match(/^adjust:([^:]+):(\d+)$/) ?? [];
    const hits = name ? await findProducts(app, customerId, name) : [];
    if (!name || !hits.length) return [`«${name || ''}» tapılmadı. Qalığı dəyişmədim.`];
    const names = [...new Set(hits.map((hit) => hit.name))];
    if (names.length > 1) return ['Bir neçə məhsul uyğun gəldi. Qalığı dəyişmədim.', ...names.map((item) => `- ${item}`)];
    const total = hits.reduce((sum, hit) => sum + hit.qty, 0);
    return [`${hits[0]?.name} hazırda ${total} ədəddir.`, `${qty} etmək üçün şifrənizi bir mesajda yazın: şifrə və ardından şifrəniz.`, 'Şifrə söhbət yaddaşında saxlanmır. Şifrə səhvdirsə heç nə dəyişmir.'];
  }
  const data = await loadAccountSummary(app, customerId);
  const lines = summaryLines(data);
  if (intent === 'earn:yesterday') lines.splice(1, 0, 'Dünənki qazanc kassanın son paketində ayrı gün kimi saxlanmır. Aşağıda bu günkü satış və son sinxronizasiyadakı qazanc var.');
  lines.push('', 'PDF istəyirsinizsə, PDF yazın.');
  return lines;
}

export async function adjustOwnedStock(app: FastifyInstance, customerId: string, query: string, qty: number, password: string): Promise<string> {
  const { verifyPassword } = await import('@milioner/security');
  const { customers } = await import('@milioner/database');
  const { eq } = await import('drizzle-orm');
  const [owner] = await app.db.select({ passwordHash: customers.passwordHash }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!owner?.passwordHash || !(await verifyPassword(owner.passwordHash, password))) return 'Şifrə düzgün deyil. Qalıq dəyişmədi.';
  const hits = await findProducts(app, customerId, query);
  const names = [...new Set(hits.map((hit) => hit.name))];
  if (names.length !== 1) return names.length ? 'Bir neçə məhsul uyğun gəldi. Qalıq dəyişmədi.' : 'Məhsul tapılmadı. Qalıq dəyişmədi.';
  const target = Math.max(0, Math.trunc(qty));
  const rows = rowsOf(await app.db.execute(sql`
    SELECT p.product_id AS id, b.warehouse_id AS warehouse, COALESCE(b.qty, 0) AS qty
    FROM market_products p
    LEFT JOIN market_stock_balances b ON b.customer_id = p.customer_id AND b.product_id = p.product_id
    WHERE p.customer_id = ${customerId}::uuid
      AND (
        lower(COALESCE(p.payload->>'name', '')) = lower(${names[0]})
        OR lower(COALESCE(p.payload#>>'{name,az}', '')) = lower(${names[0]})
      )
    ORDER BY COALESCE(b.qty, 0) DESC
  `));
  const productId = String(rows[0]?.id ?? '');
  if (!productId) return 'Məhsul tapılmadı. Qalıq dəyişmədi.';
  const current = rows.reduce((sum, row) => sum + num(row.qty), 0);
  const warehouseId = String(rows.find((row) => row.warehouse)?.warehouse || 'wh-sales');
  const delta = target - current;
  if (delta === 0) return `${names[0]} artıq ${target} ədəddir. Dəyişiklik edilmədi.`;
  const now = new Date().toISOString();
  try { await app.db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO market_stock_balances (customer_id, product_id, warehouse_id, qty, updated_at)
      VALUES (${customerId}::uuid, ${productId}, ${warehouseId}, ${Math.max(0, num(rows.find((row) => String(row.warehouse) === warehouseId)?.qty) + delta)}, ${now}::timestamptz)
      ON CONFLICT (customer_id, product_id, warehouse_id)
      DO UPDATE SET qty = GREATEST(0, market_stock_balances.qty + ${delta}), updated_at = EXCLUDED.updated_at
    `);
    const state = rowsOf(await tx.execute(sql`SELECT server_seq FROM market_sync_state WHERE customer_id = ${customerId}::uuid LIMIT 1`));
    const nextSeq = num(state[0]?.server_seq) + 1;
    const eventId = `server:${customerId}:${nextSeq}:chat`;
    await tx.execute(sql`
      INSERT INTO market_sync_events (customer_id, event_id, origin_device_id, origin_seq, kind, payload, created_at, received_at)
      VALUES (${customerId}::uuid, ${eventId}, '00000000-0000-4000-a000-000000000001'::uuid, ${nextSeq}, 'stock.movement',
        ${JSON.stringify({ productId, warehouseId, qtyDelta: delta, type: 'ADJUST', refType: 'chat', note: 'Söhbət təsdiqi' })}::jsonb,
        now(), now())
    `);
    await tx.execute(sql`
      INSERT INTO market_sync_state (customer_id, catalog_revision, server_seq, updated_at)
      VALUES (${customerId}::uuid, 1, ${nextSeq}, now())
      ON CONFLICT (customer_id) DO UPDATE SET catalog_revision = market_sync_state.catalog_revision + 1, server_seq = ${nextSeq}, updated_at = now()
    `);
  });
  } catch { return 'Qalıq yazılmadı. Şifrə düzgün idi, amma stok cədvəli bu dəyişikliyi qəbul etmədi.'; }
  return `${names[0]} qalığı ${current} ədəddən ${target} ədədə dəyişdi. Kassa növbəti sinxronizasiyada bunu alacaq.`;
}

export function summaryLines(data: AccountSummary): string[] {
  const azn = (minor: number) => {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(Math.round(minor));
    return `${sign}${(abs / 100).toFixed(2)} AZN`;
  };
  if (data.empty) return ['Hesabınızda hələ sinxron olunmuş satış və ya anbar məlumatı yoxdur.', 'Kassanı açıq və internetə bağlı saxlayın, sonra yenidən soruşun.'];
  const lines = ['Possistem hesabatı', ''];
  if (data.branches.length) {
    lines.push('Filiallar:');
    for (const row of data.branches) {
      const when = row.updatedAt ? new Date(row.updatedAt).toLocaleString('az-AZ') : 'vaxt yoxdur';
      lines.push(`- ${row.name}: bugünkü satış ${azn(row.salesToday)} (${when})`);
    }
    lines.push('');
  }
  lines.push(`Cəmi bugünkü satış: ${azn(data.salesToday)}`);
  if (data.profitToday != null) lines.push(`Bugünkü qazanc (satış − maya): ${azn(data.profitToday)}`);
  if (data.profitAll != null) lines.push(`Ümumi qazanc, son sinxronizasiya üzrə: ${azn(data.profitAll)}`);
  if (data.profitToday == null && data.profitAll == null) lines.push('Qazancı ayırmaq üçün məhsul kartında maya qiyməti yoxdur. Satış məbləğini göstərirəm.');
  if (data.stockSaleValue != null) lines.push(`Anbarın satış dəyəri (qalıq × satış qiyməti): ${azn(data.stockSaleValue)}`);
  if (data.stockCostValue != null) lines.push(`Anbarın maya dəyəri: ${azn(data.stockCostValue)}`);
  lines.push('', 'Rəqəmlər kassanın son göndərdiyi məlumatdır. Sənədlər dəyişdirilmir.');
  return lines;
}

export async function summaryPdf(lines: string[]): Promise<Buffer> {
  const PDFDocument = require('pdfkit') as new (opts?: object) => {
    font: (src: string) => unknown;
    fontSize: (n: number) => { text: (s: string) => unknown; moveDown: () => unknown };
    on: (ev: string, fn: (c?: Buffer) => void) => void;
    end: () => void;
  };
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => { if (chunk) chunks.push(chunk); });
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (existsSync(FONT)) doc.font(FONT);
    doc.fontSize(16).text(lines[0] || 'Possistem');
    doc.fontSize(11);
    for (const line of lines.slice(1)) doc.fontSize(11).text(line || ' ');
    doc.end();
  });
}
