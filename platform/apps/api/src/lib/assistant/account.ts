/**
 * Questions about the signed-in owner's own business: sales, cash, stock,
 * subscription and tills. Market numbers come from what the tills last synced
 * to the server (and the live till when it is online); restaurant owners are
 * served by the WhatsApp bot's command layer, which already talks to the till
 * and guards price/Z changes behind a confirmation code.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { link, type Link } from './engine.js';
import { fold, type Lang } from './text.js';
import { azn } from './facts.js';
import { ownerBranchDevices, branchOnline, branchRpc } from '../../routes/cloud-branches.js';
import { handleBotMessage } from '../bot/commands.js';
import { searchProductsLive } from '../mysql.js';
import { adjustOwnedStock } from '../support-summary.js';

type Row = Record<string, any>;
const rows = (r: unknown): Row[] => (Array.isArray(r) ? r : ((r as { rows?: Row[] })?.rows ?? []));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pick = (lang: Lang, az: string, en: string, ru: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);

export type Period = 'today' | 'yesterday' | 'week' | 'month';
export type Intent =
  | { kind: 'sales'; period: Period }
  | { kind: 'profit'; period: Period }
  | { kind: 'cash' }
  | { kind: 'checks'; period: Period }
  | { kind: 'top'; period: Period | null }
  | { kind: 'low' }
  | { kind: 'stock_value' }
  | { kind: 'product'; needle: string }
  | { kind: 'product_list' }
  | { kind: 'subscription' }
  | { kind: 'devices' }
  | { kind: 'tables' }
  | { kind: 'staff' }
  | { kind: 'last_report' }
  | { kind: 'x_report' }
  | { kind: 'z_report' }
  | { kind: 'price_set'; needle: string; raw: string }
  | { kind: 'stock_set'; needle: string; qty: number }
  | { kind: 'code'; code: string }
  | { kind: 'cancel' };

export type AccountReply = {
  id: string;
  text: string;
  links?: Link[];
  chips?: string[];
  confirm?: { token: string; summary: string };
  needLogin?: boolean;
};

const periodOf = (f: string): Period =>
  /(?:^|$|(?<= )|(?= ))(dunen|dunenki|yesterday|вчера)/.test(f) ? 'yesterday'
    : /(?:^|$|(?<= )|(?= ))(bu hefte|hefte|heftelik|this week|недел)/.test(f) ? 'week'
      : /(?:^|$|(?<= )|(?= ))(bu ay|ayliq|bu ayki|this month|месяц)/.test(f) ? 'month'
        : 'today';

/** "how do I …" phrasing — a question about the feature, not a request for my numbers. */
const HOW_TO = /(?:^|$|(?<= )|(?= ))can i(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))olar(mi)?$|(?:^|$|(?<= )|(?= ))ne (edim|etmeliyem|etmek lazimdir)(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))nece \S+(im|um|yim|yum|am|em|yam|yem)(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))nece (gorum|baxim|cixarim|edim|hesablanir|yazilir|qurum|elave|tapim|bilim|deyisim|yaradim|acim|baglayim|qosum)|(?:^|$|(?<= )|(?= ))harada (gorum|baxim)|(?:^|$|(?<= )|(?= ))how (do|can|to) i(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))how is(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))как (посмотреть|увидеть|сделать|изменить|рассчит)/;
const MINE = /(?:^|$|(?<= )|(?= ))(menim|bizim|my|our|мой|моя|мои|у меня)(?:^|$|(?<= )|(?= ))|(qazancim|satisim|anbarim|kassam|kassalarim|mallarim|abuneliyim|lisenziyam|qazandim|qazanmisam|satmisam|satdim)/;

const STOP_PRODUCT = new Set(['anbarda', 'anbar', 'anbarimda', 'stokda', 'stok', 'var', 'varmi', 'qaldi', 'qalib', 'qaligi', 'qaliq', 'qiymeti', 'qiymet', 'neceyedir', 'neceye', 'nece', 'eded', 'ededdir', 'ne', 'qeder', 'mehsul', 'mal', 'menim', 'de', 'goster', 'bax', 'nedir', 'how', 'many', 'much', 'stock', 'in', 'do', 'we', 'have', 'is', 'the', 'price', 'of', 'есть', 'ли', 'на', 'складе', 'сколько', 'цена', 'остаток', 'mi', 'mu', 'bizde', 'bize', 'hele', 'indi', 'manat', 'manatdir', 'azn', 'aylig', 'ayliq', 'illik', 'abune', 'paket']);

function productNeedle(f: string): string {
  const bare = (w: string) => w.replace(/(lari|leri|lar|ler|nun|nin|un|in|nu|ni|u|i)$/, '');
  const words = f.split(' ').filter((w) => w.length >= 2 && !STOP_PRODUCT.has(w) && !STOP_PRODUCT.has(bare(w)) && !/^\d+$/.test(w)).slice(0, 3);
  const last = words.length - 1;
  if (last >= 0) {
    const cut = words[last]!.replace(/(nin|nun|in|un|ni|nu|da|de|dan|den|ya|ye)$/, '');
    if (cut.length >= 3) words[last] = cut;
  }
  return words.join(' ');
}

export function detectAccountIntent(raw: string): Intent | null {
  const f = fold(raw);
  if (!f) return null;
  if (/^\d{4}$/.test(f)) return { kind: 'code', code: f };
  if (/^\d{6,14}$/.test(f)) return { kind: 'product', needle: f };
  if (/^(legv|legv et|imtina|cancel|отмена)$/.test(f)) return { kind: 'cancel' };
  if (/^(x|iks) ?(hesabat|hesabati|report|rapor|отчет)( cixar| ver| goster)?$/.test(f)) return { kind: 'x_report' };
  if (/^(z|zed) ?(hesabat|hesabati|report|rapor|отчет)( cixar| ver| et| bagla)?$|^gunu bagla$|(^| )(sifirla|sifirlamaq|sifirlayim|reset the till|обнулить)( |$)/.test(f)) return { kind: 'z_report' };

  const stockSet = /^(.+?)\s+(?:qaligini|qaligi|stokunu|stoku|ededini|miqdarini|sayini)\s+(\d{1,7})\s*(?:et|ele|edin|yaz|qoy)?$/.exec(f)
    ?? /^set\s+(.+?)\s+stock\s+to\s+(\d{1,7})$/.exec(f);
  if (stockSet) {
    const needle = productNeedle(stockSet[1]!);
    if (needle) return { kind: 'stock_set', needle, qty: Number(stockSet[2]) };
  }
  const priceSet = /^(.+?)\s+(?:qiymetini|qiymeti)\s+(\d+(?:[.,]\d{1,2})?)\s*(?:manat|azn|m)?\s*(?:et|ele|edin|yaz|qoy)?$/.exec(f)
    ?? /^qiymet\s+(.+?)\s+(\d+(?:[.,]\d{1,2})?)$/.exec(f);
  if (priceSet) {
    const needle = productNeedle(priceSet[1]!);
    if (needle) return { kind: 'price_set', needle, raw: `qiymet ${needle} ${priceSet[2]!.replace(',', '.')}` };
  }
  // "anbarda məhsullarıma bax, list çıxar", "mallarımın siyahısı" — the owner's own catalogue, not a how-to.
  if (/(mehsullarim|mallarim|mehsullarimi|mallarimi|mehsullarimin|mallarimin|(mehsul|mal|mallarin|mehsullarin) siyahi|siyahi(ni)? (cixar|ver|goster)|list(i|ini)? (cixar|ver|goster)|anbarda (ne|nə) var|anbarimda (ne|nə) var|butun (mallar|mehsullar)|my products|product list|список товаров)/.test(f)) return { kind: 'product_list' };
  if (HOW_TO.test(f) && !/(qazancim|satisim|anbarim|kassam|qazandim|qazanmisam|satmisam|satdim)/.test(f)) return null;

  if (/abunel(iy|ik)(im|in)|lisenziyam|ne vaxt bitir|nece gun qalib|my subscription|when does my|моя подписка|когда заканчивается подписка/.test(f)) return { kind: 'subscription' };
  if (/kassalarim|cihazlarim|kassalar onlayn|kassa qosulu|my tills|мои кассы/.test(f)) return { kind: 'devices' };
  if (/^(masalar|aciq masalar|stollar)$|aciq masalar|hansi masalar dolu|open tables|открытые столы/.test(f)) return { kind: 'tables' };
  if (/^(novbe|isciler|kim var|kim isleyir)$|novbede kim|who is on shift|кто на смене/.test(f)) return { kind: 'staff' };
  if (/^son hesabat|last report|последний отчет/.test(f)) return { kind: 'last_report' };
  if (/(?:^|$|(?<= )|(?= ))(en cox satilan|cox satilan|top mehsul|top 10|populyar mehsul|best sell|top sell|лидеры продаж|самые продаваем)/.test(f) || /^top$/.test(f)) return { kind: 'top', period: /(bugun|bu gun|dunen|hefte|bu ay|ayliq|today|yesterday|week|month|сегодня|вчера|недел|месяц)/.test(f) ? periodOf(f) : null };
  if (/(?:^|$|(?<= )|(?= ))(az qalan|bitmek uzre|bitmekde olan|kritik qaliq|qurtaran|low stock|running out|заканчива|мало осталось)/.test(f)) return { kind: 'low' };
  if (/anbarin deyeri|anbar deyeri|anbarin maya|mallarin deyeri|stock value|стоимость склада/.test(f)) return { kind: 'stock_value' };
  if (/kassada ne qeder pul|kassada pul|kassa qaligi|nagd ne qeder|cash in the till|how much cash|сколько денег в кассе|деньги в кассе/.test(f)) return { kind: 'cash' };
  if (/nece cek|cek sayi|nece satis olub|nece musteri|how many (receipts|sales)|сколько чеков/.test(f)) return { kind: 'checks', period: periodOf(f) };
  if (/qazanc|qazan(d|m)|menfeet|xalis gelir|profit|earn|прибыл|заработ/.test(f) && (MINE.test(f) || /(?:^|$|(?<= )|(?= ))(de|goster|soyle)(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))(bugun|bu gun|dunen|bu ay|bu hefte|ne qeder|neqeder|today|yesterday|сегодня|вчера|сколько)/.test(f) || /^qazanc/.test(f)) && !/(?:^|$|(?<= )|(?= ))nece(?:^|$|(?<= )|(?= ))/.test(f)) return { kind: 'profit', period: periodOf(f) };
  if (/(satis|dovriyye|ciro|kassa|sales|revenue|turnover|выручк|продаж)/.test(f) && (MINE.test(f) || /(?:^|$|(?<= )|(?= ))(bugun|bu gun|dunen|bu ay|bu hefte|ne qeder|neqeder|today|yesterday|сегодня|вчера|сколько)/.test(f)) && !/(?:^|$|(?<= )|(?= ))nece(?:^|$|(?<= )|(?= ))/.test(f) && !/(?:^|$|(?<= )|(?= ))(proqram|program|sistem|qiymet|paket|lazim)/.test(f)) return { kind: 'sales', period: periodOf(f) };
  if (/nagd ve kart|kartla ne qeder|nagd ne qeder satis|cash and card|наличные и карт/.test(f)) return { kind: 'sales', period: periodOf(f) };

  const lookup = /(?:^|$|(?<= )|(?= ))(anbarda|stokda|anbarimda)(?:^|$|(?<= )|(?= )).*(?:^|$|(?<= )|(?= ))(var|varmi|qalib|nece|ne qeder)(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))(qaligi|qaligi nedir|nece eded|nece dene|qalib mi|qaldi mi)(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))(in stock|do we have|есть ли .* на складе|сколько .* осталось)/.test(f);
  const priceAsk = /(?:^|$|(?<= )|(?= ))(\w+(nin|nun|in|un)) qiymeti(?:^|$|(?<= )|(?= ))|(?:^|$|(?<= )|(?= ))qiymeti (nedir|nece|neceye)(?:^|$|(?<= )|(?= ))|price of/.test(f) && !/(proqram|program|paket|abune|tarif|printer|skaner|terezi|komputer|monoblok|avadanliq)/.test(f);
  if (lookup || priceAsk) {
    const needle = productNeedle(f);
    if (needle && !/(proqram|program|sistem|demo|printer|skaner|terezi|kompyuter|komputer)/.test(needle)) return { kind: 'product', needle };
  }
  return null;
}

/** "cola var?" — a product only if the knowledge base has nothing better; see assistantReply. */
export function weakProductIntent(raw: string): Intent | null {
  const f = fold(raw);
  const m = /^(.+?) (var|varmi|qalib|qalibmi|qaldi|qaldimi)$/.exec(f);
  if (!m || HOW_TO.test(f)) return null;
  const needle = productNeedle(m[1]!);
  return needle && needle.split(' ').length <= 3 ? { kind: 'product', needle } : null;
}

type Device = { id: string; name: string; product: 'market' | 'restaurant'; app_version: string | null; last_seen_at: unknown; hostname: string | null; register_name: string | null };

async function devicesOf(app: FastifyInstance, customerId: string): Promise<Device[]> {
  return (await ownerBranchDevices(app, customerId)) as unknown as Device[];
}

const when = (value: unknown, lang: Lang) => {
  const ms = typeof value === 'number' ? value : Date.parse(value instanceof Date ? value.toISOString() : String(value ?? ''));
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', { timeZone: 'Asia/Baku', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** WhatsApp formatting (*bold*, `code`) reads as noise in the web chat. */
const plain = (text: string) => text.replace(/\*([^*\n]+)\*/g, '$1').replace(/`([^`\n]+)`/g, '$1');

async function restaurantCommand(app: FastifyInstance, customerId: string, command: string): Promise<string> {
  const out: string[] = [];
  const [owner] = rows(await app.db.execute(sql`SELECT name FROM customers WHERE id=${customerId}::uuid LIMIT 1`));
  await handleBotMessage({
    app,
    customerId,
    // One confirmation slot per owner for the web chat, separate from any WhatsApp number.
    from: `web-assistant:${customerId}`,
    settings: { botEnabled: true, permissions: { read: true, reports: true, catalog: true, alerts: true }, adminName: String(owner?.name ?? '') },
    send: async (text) => { out.push(plain(text)); },
  }, command);
  return out.join('\n\n') || 'Kassa cavab vermədi.';
}

type Snapshot = { name: string; sales: number; cash: number; card: number; count: number; openRegisters: number; registers: Row[]; lowStock: Row[]; critical: number; updatedAt: unknown };

async function marketSnapshots(app: FastifyInstance, customerId: string): Promise<Snapshot[]> {
  const list = rows(await app.db.execute(sql`
    SELECT COALESCE(b.name, s.payload->>'branchName', d.register_name, d.hostname, 'Filial') AS name,
           s.daily_sales_minor, s.payload, s.updated_at
    FROM market_pos_snapshots s
    LEFT JOIN devices d ON d.id = s.device_id
    LEFT JOIN branches b ON b.id = d.branch_id
    WHERE s.customer_id = ${customerId}::uuid AND (d.status IS NULL OR d.status <> 'revoked')
    ORDER BY s.updated_at DESC LIMIT 40`));
  return list.map((r) => {
    const p = (r.payload ?? {}) as Row;
    return {
      name: String(r.name || 'Filial'),
      sales: num(p.dailySalesMinor ?? r.daily_sales_minor),
      cash: num(p.cashMinor), card: num(p.cardMinor), count: num(p.transactionCount),
      openRegisters: num(p.openRegisters), registers: Array.isArray(p.registers) ? p.registers : [],
      lowStock: Array.isArray(p.lowStock) ? p.lowStock : [], critical: num(p.criticalStock),
      updatedAt: p.updatedAt ?? r.updated_at,
    };
  });
}

/** A snapshot is "today" only if the till wrote it today, Baku time. */
const isToday = (value: unknown) => {
  const ms = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  if (!Number.isFinite(ms)) return false;
  const day = (d: number) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Baku' });
  return day(ms) === day(Date.now());
};

async function liveGoods(app: FastifyInstance, customerId: string, device: Device): Promise<Row[] | null> {
  const data = await liveCall(app, customerId, device, 'goods.list');
  return Array.isArray(data?.goods) ? data.goods : null;
}

/** One read-only call to an online market till through the portal's branch RPC (no audit: reads only). */
async function liveCall(app: FastifyInstance, customerId: string, device: Device, method: string, payload: Record<string, unknown> = {}): Promise<Row | null> {
  let status = 200; let sent: unknown = null;
  const reply = { code(c: number) { status = c; return this; }, send(b: unknown) { sent = b; return this; }, header() { return this; } };
  const req = { log: app.log, headers: {}, ip: '127.0.0.1' };
  const result = await branchRpc(app, req, reply, {
    customerId, source: null, target: device as unknown as Record<string, any>,
    body: { requestId: randomUUID(), calls: [{ method, payload }] }, auditAction: 'assistant.read', timeoutMs: 15000,
  }).catch(() => null);
  const value = (result && typeof result === 'object' && 'results' in (result as Row) ? result : sent) as Row | null;
  if (status !== 200 || !value?.results) return null;
  const first = (value.results as Row[])[0];
  return first?.success && first.data && typeof first.data === 'object' ? first.data as Row : null;
}

const BAKU_MS = 4 * 3_600_000;
/** [from, to) in epoch ms for a Baku-time period. */
function periodRange(period: Period, now = Date.now()): [number, number] {
  const local = now + BAKU_MS;
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000 - BAKU_MS;
  if (period === 'yesterday') return [dayStart - 86_400_000, dayStart];
  if (period === 'week') { const dow = (new Date(local).getUTCDay() + 6) % 7; return [dayStart - dow * 86_400_000, now + 1]; }
  if (period === 'month') { const d = new Date(local); return [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - BAKU_MS, now + 1]; }
  return [dayStart, now + 1];
}

type LiveSales = { total: number; cash: number; card: number; account: number; count: number; refunds: number; discount: number; top: Row[]; branches: string[]; offline: string[] };

/** Closed sales for the period from every online market till, summed. */
async function liveSales(app: FastifyInstance, customerId: string, market: Device[], period: Period): Promise<LiveSales | null> {
  const [from, to] = periodRange(period);
  const out: LiveSales = { total: 0, cash: 0, card: 0, account: 0, count: 0, refunds: 0, discount: 0, top: [], branches: [], offline: [] };
  const top = new Map<string, Row>();
  for (const device of market) {
    if (!branchOnline(device as unknown as Row)) { out.offline.push(device.name); continue; }
    const data = await liveCall(app, customerId, device, 'sales.list', { from, to });
    if (!data) { out.offline.push(device.name); continue; }
    out.branches.push(device.name);
    for (const sale of (Array.isArray(data.sales) ? data.sales : []) as Row[]) {
      if (sale.deletedAt || (sale.status && sale.status !== 'closed')) continue;
      out.total += num(sale.totalMinor); out.cash += num(sale.cashMinor); out.card += num(sale.cardMinor); out.account += num(sale.accountMinor);
      out.refunds += num(sale.refundedMinor); out.discount += num(sale.discountMinor); out.count += 1;
    }
    for (const t of (Array.isArray(data.top) ? data.top : []) as Row[]) {
      const e = top.get(String(t.name)) ?? { name: t.name, quantity: 0, totalMinor: 0 };
      e.quantity = num(e.quantity) + num(t.quantity); e.totalMinor = num(e.totalMinor) + num(t.totalMinor);
      top.set(String(t.name), e);
    }
  }
  if (!out.branches.length) return null;
  out.top = [...top.values()].sort((a, b) => num(b.totalMinor) - num(a.totalMinor)).slice(0, 10);
  return out;
}

const periodName = (period: Period, lang: Lang) => ({
  today: pick(lang, 'Bu gün', 'Today', 'Сегодня'),
  yesterday: pick(lang, 'Dünən', 'Yesterday', 'Вчера'),
  week: pick(lang, 'Bu həftə', 'This week', 'На этой неделе'),
  month: pick(lang, 'Bu ay', 'This month', 'В этом месяце'),
})[period];

const pendingStock = new Map<string, { customerId: string; needle: string; qty: number; expires: number }>();

export async function confirmPending(app: FastifyInstance, customerId: string, token: string, password: string, lang: Lang): Promise<{ ok: boolean; text: string }> {
  const pending = pendingStock.get(token);
  if (!pending || pending.customerId !== customerId || pending.expires < Date.now()) {
    pendingStock.delete(token);
    return { ok: false, text: pick(lang, 'Təsdiq vaxtı keçib. Əmri yenidən yazın.', 'This confirmation has expired. Send the command again.', 'Подтверждение устарело. Отправьте команду снова.') };
  }
  const text = await adjustOwnedStock(app, customerId, pending.needle, pending.qty, password);
  if (!text.startsWith('Şifrə düzgün deyil')) pendingStock.delete(token);
  return { ok: !text.startsWith('Şifrə düzgün deyil'), text };
}

export async function answerAccount(app: FastifyInstance, customerId: string | null, intent: Intent, lang: Lang): Promise<AccountReply> {
  const login = link('/pos/app/login', 'Daxil ol', 'Sign in', 'Войти');
  if (!customerId) {
    return {
      id: 'account_login', needLogin: true,
      text: pick(lang,
        'Bu sizin hesabınızın məlumatıdır. Göstərmək üçün müştəri hesabınıza daxil olun — aşağıdakı formadan və ya portal girişindən. Sonra sualı yenidən yazın.',
        'That is your own account data. Sign in to your customer account — below or via the portal — then ask again.',
        'Это данные вашего аккаунта. Войдите в аккаунт клиента — ниже или через портал — и спросите снова.'),
      links: [login],
    };
  }

  if (intent.kind === 'subscription') {
    const subs = rows(await app.db.execute(sql`SELECT product, monthly_amount_minor, enabled, paid_until, auto_renew FROM billing_subscriptions WHERE customer_id=${customerId}::uuid ORDER BY product`));
    if (!subs.length) return { id: 'acc_subscription', text: pick(lang, 'Hesabınızda aktiv abunəlik qeydi tapmadım. Lisenziya satış komandası tərəfindən açılır: 051 333 35 55.', 'I found no subscription on your account. Sales activates licences: 051 333 35 55.', 'Подписки в аккаунте не найдено. Лицензию подключает отдел продаж: 051 333 35 55.'), links: [link('/pos/app/abunelik', 'Abunəlik', 'Subscription', 'Подписка')] };
    const lines = subs.map((s) => {
      const name = s.product === 'market' ? 'Market POS' : s.product === 'restaurant' ? 'Restoran POS' : String(s.product);
      const until = s.paid_until ? new Date(s.paid_until).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', { timeZone: 'Asia/Baku' }) : '—';
      const days = s.paid_until ? Math.ceil((Date.parse(new Date(s.paid_until).toISOString()) - Date.now()) / 86_400_000) : null;
      const left = days == null ? '' : days >= 0 ? pick(lang, ` (${days} gün qalıb)`, ` (${days} days left)`, ` (осталось ${days} дн.)`) : pick(lang, ' (müddət bitib)', ' (expired)', ' (истекла)');
      return `• ${name}: ${azn(num(s.monthly_amount_minor))}/${pick(lang, 'ay', 'month', 'мес')}, ${pick(lang, 'ödənilib', 'paid until', 'оплачено до')} ${until}${left}${s.auto_renew ? pick(lang, ', avtomatik ödəniş açıq', ', auto-pay on', ', автоплатёж включён') : ''}${s.enabled ? '' : pick(lang, ', dayandırılıb', ', disabled', ', отключена')}`;
    });
    return { id: 'acc_subscription', text: `${pick(lang, 'Abunəliyiniz', 'Your subscription', 'Ваша подписка')}:\n${lines.join('\n')}`, links: [link('/pos/app/abunelik', 'Abunəlik', 'Subscription', 'Подписка')], chips: ['pay_methods'] };
  }

  const devices = await devicesOf(app, customerId);
  if (intent.kind === 'devices') {
    if (!devices.length) return { id: 'acc_devices', text: pick(lang, 'Hesabınıza hələ aktiv kassa qoşulmayıb. Quraşdırma bələdçisinə baxın.', 'No active till is linked to your account yet. See the installation guide.', 'К аккаунту ещё не подключена касса. См. инструкцию по установке.'), links: [link('/qurasdirma/', 'Quraşdırma', 'Installation', 'Установка')] };
    const lines = devices.map((d) => `• ${d.name}${d.register_name && d.register_name !== d.name ? ` · ${d.register_name}` : ''} (${d.product === 'market' ? 'Market' : 'Restoran'}): ${branchOnline(d as unknown as Row) ? pick(lang, '🟢 onlayn', '🟢 online', '🟢 онлайн') : pick(lang, '🔴 oflayn', '🔴 offline', '🔴 офлайн')}, ${pick(lang, 'son əlaqə', 'last seen', 'связь')} ${when(d.last_seen_at, lang)}${d.app_version ? `, v${d.app_version}` : ''}`);
    return { id: 'acc_devices', text: `${pick(lang, 'Kassalarınız', 'Your tills', 'Ваши кассы')}:\n${lines.join('\n')}`, chips: ['update', 'not_visible'] };
  }

  const market = devices.filter((d) => d.product === 'market');
  const restaurant = devices.filter((d) => d.product === 'restaurant');
  const restaurantOnly = restaurant.length > 0 && market.length === 0;
  if (!devices.length) {
    return { id: 'acc_none', text: pick(lang, 'Hesabınıza hələ kassa qoşulmayıb, ona görə satış və anbar rəqəmi yoxdur. Kassa quraşdırılıb internetə qoşulandan sonra burada görünəcək.', 'No till is linked to your account yet, so there are no sales or stock numbers. They appear here once a till is installed and online.', 'К аккаунту ещё не подключена касса, поэтому цифр нет. Они появятся после установки и подключения кассы.'), links: [link('/qurasdirma/', 'Quraşdırma', 'Installation', 'Установка')] };
  }

  // Restaurant owners: the bot already knows how to read the live mirror and drive the till.
  if (restaurantOnly || intent.kind === 'code' || intent.kind === 'cancel' || ((intent.kind === 'x_report' || intent.kind === 'z_report' || intent.kind === 'tables' || intent.kind === 'staff' || intent.kind === 'last_report' || intent.kind === 'price_set') && restaurant.length > 0)) {
    const command = intent.kind === 'sales' || intent.kind === 'cash' || intent.kind === 'checks' ? (intent.kind === 'sales' && intent.period === 'yesterday' ? 'hesabat dunen' : 'satis')
      : intent.kind === 'profit' ? 'umumi'
        : intent.kind === 'top' ? 'top'
          : intent.kind === 'tables' ? 'masalar'
            : intent.kind === 'staff' ? 'novbe'
              : intent.kind === 'last_report' ? 'son hesabat'
                : intent.kind === 'x_report' ? 'x hesabat'
                  : intent.kind === 'z_report' ? 'z hesabat'
                    : intent.kind === 'price_set' ? intent.raw
                      : intent.kind === 'product' ? `mehsul ${intent.needle}`
                        : intent.kind === 'code' ? intent.code
                          : intent.kind === 'cancel' ? 'legv'
                            : intent.kind === 'low' || intent.kind === 'stock_value' || intent.kind === 'stock_set' ? '' : 'umumi';
    if (command) {
      const text = await restaurantCommand(app, customerId, command);
      return { id: `acc_rest_${intent.kind}`, text };
    }
  }

  if (intent.kind === 'x_report' || intent.kind === 'z_report') {
    return { id: 'acc_xz', text: pick(lang,
      'Market POS-da X və Z hesabatı kassanın özündə çıxarılır: Hesabatlar → X (günün cari vəziyyəti) və ya Z (günü bağlayır). Z hesabatı geri qaytarılmır, ona görə uzaqdan bağlamıram. Günün cari rəqəmləri üçün “bugünkü satış” yazın.',
      'In Market POS, X and Z reports are run on the till: Reports → X (day so far) or Z (closes the day). A Z report cannot be undone, so I do not close it remotely. For today’s numbers ask “today’s sales”.',
      'В Маркет POS X- и Z-отчёты снимаются на кассе: Отчёты → X (текущее) или Z (закрывает день). Z нельзя отменить, поэтому удалённо не закрываю. Для цифр за сегодня спросите «продажи сегодня».'), chips: ['xz'] };
  }

  if (intent.kind === 'price_set') {
    return { id: 'acc_price_market', text: pick(lang,
      `Market POS-da qiyməti kassa proqramında dəyişin: Məhsullar → «${intent.needle}» kartını açın → satış qiyməti → Saxla. Növbəti satışdan tətbiq olunur. Qiymət dəyişikliyini bu chatdan uzaqdan etmirəm ki, səhvən yanlış məhsula yazılmasın.`,
      `In Market POS change the price in the till app: Products → open “${intent.needle}” → sale price → Save. It applies from the next sale. I do not change market prices from the chat to avoid hitting the wrong product.`,
      `В Маркет POS цену меняют в программе: Товары → «${intent.needle}» → цена продажи → Сохранить. Применится со следующей продажи. Из чата цены маркета не меняю, чтобы не задеть не тот товар.`), chips: ['price_change_howto'] };
  }

  if (intent.kind === 'stock_set') {
    const hits = await findOwned(app, customerId, intent.needle);
    const names = [...new Set(hits.map((h) => h.name))];
    if (!names.length) return { id: 'acc_stock_set', text: pick(lang, `«${intent.needle}» adlı məhsul tapmadım, qalığı dəyişmədim. Adı kassadakı kimi yazın.`, `No product “${intent.needle}” found; nothing changed.`, `Товар «${intent.needle}» не найден, ничего не изменено.`) };
    if (names.length > 1) return { id: 'acc_stock_set', text: `${pick(lang, 'Bir neçə məhsul uyğun gəldi, qalığı dəyişmədim. Dəqiq adı yazın:', 'Several products match; nothing changed. Use the exact name:', 'Подходит несколько товаров, ничего не изменено. Уточните:')}\n${names.slice(0, 8).map((n) => `• ${n}`).join('\n')}` };
    const current = hits.reduce((s, h) => s + h.qty, 0);
    const token = randomUUID();
    pendingStock.set(token, { customerId, needle: names[0]!, qty: intent.qty, expires: Date.now() + 5 * 60_000 });
    const summary = pick(lang, `${names[0]}: ${current} → ${intent.qty}`, `${names[0]}: ${current} → ${intent.qty}`, `${names[0]}: ${current} → ${intent.qty}`);
    return { id: 'acc_stock_set', text: pick(lang,
      `${names[0]} hazırda ${current} ədəddir. ${intent.qty} etmək üçün hesab şifrənizi aşağıdakı sahədə təsdiqləyin (5 dəqiqə keçərlidir). Şifrə söhbətdə saxlanmır; səhv olsa heç nə dəyişmir. Kassa dəyişikliyi növbəti sinxronizasiyada alacaq.`,
      `${names[0]} is currently ${current}. To set it to ${intent.qty}, confirm with your account password below (valid 5 minutes). The password is not stored; if wrong, nothing changes. The till picks it up on the next sync.`,
      `Сейчас ${names[0]}: ${current}. Чтобы сделать ${intent.qty}, подтвердите паролем аккаунта ниже (5 минут). Пароль не сохраняется; при ошибке ничего не меняется. Касса получит изменение при синхронизации.`),
      confirm: { token, summary } };
  }

  if (intent.kind === 'product_list') {
    if (restaurantOnly) {
      const list = await searchProductsLive(customerId, '', 60);
      if (!list.length) return { id: 'acc_product_list', text: pick(lang, 'Restoran kassasından serverə hələ menyu məlumatı gəlməyib. Kassanı açıq və internetə bağlı saxlayın.', 'No menu data has reached the server from the restaurant till yet.', 'Меню с ресторанной кассы ещё не поступило на сервер.') };
      return { id: 'acc_product_list', text: `${pick(lang, 'Menyunuz', 'Your menu', 'Ваше меню')} (${list.length}):\n${list.map((p) => `• ${p.name} — ${azn(num(p.price_minor))}${num(p.sold_out) ? pick(lang, ' · bitib', ' · sold out', ' · закончилось') : ''}`).join('\n')}` };
    }
    const rowsList = rows(await app.db.execute(sql`
      SELECT COALESCE(p.payload#>>'{name,az}', p.payload->>'name', p.product_id) AS name, p.payload->>'barcode' AS barcode,
             COALESCE((p.payload->>'priceMinor')::numeric, 0) AS price, COALESCE((p.payload->>'minStock')::numeric, 0) AS min,
             COALESCE(p.payload->>'unit', 'əd') AS unit, COALESCE(SUM(b.qty), (p.payload->>'stock')::numeric, 0) AS qty
      FROM market_products p LEFT JOIN market_stock_balances b ON b.customer_id = p.customer_id AND b.product_id = p.product_id
      WHERE p.customer_id = ${customerId}::uuid AND COALESCE((p.payload->>'active')::boolean, true)
      GROUP BY p.product_id, p.payload ORDER BY 1 LIMIT 501`));
    if (!rowsList.length) return { id: 'acc_product_list', text: pick(lang, 'Anbarınızda hələ məhsul yoxdur. Məhsulları kassa proqramında Məhsullar bölməsindən əlavə edin və ya Excel-dən import edin.', 'There are no products in your stock yet. Add them in the till app or import from Excel.', 'На складе пока нет товаров. Добавьте их в программе кассы или импортируйте из Excel.'), chips: ['product_add', 'import'] };
    const shown = rowsList.slice(0, 40);
    const low = rowsList.filter((r) => num(r.min) > 0 && num(r.qty) <= num(r.min)).length;
    const lines = shown.map((r) => `• ${r.name}: ${num(r.qty)} ${r.unit} · ${azn(num(r.price))}${num(r.min) > 0 && num(r.qty) <= num(r.min) ? ' ⚠️' : ''}`);
    const more = rowsList.length > shown.length ? pick(lang, `\n…və daha ${rowsList.length > 500 ? '460+' : rowsList.length - shown.length} məhsul. Konkret malı adı ilə soruşun və ya portalda Anbar bölməsini açın.`, `\n…and ${rowsList.length - shown.length} more. Ask about a product by name or open Stock in the portal.`, `\n…и ещё ${rowsList.length - shown.length}. Спросите товар по названию или откройте Склад в портале.`) : '';
    return { id: 'acc_product_list', text: `${pick(lang, 'Anbardakı məhsullarınız', 'Your products in stock', 'Ваши товары на складе')} (${rowsList.length > 500 ? '500+' : rowsList.length}):\n${lines.join('\n')}${more}${low ? pick(lang, `\n\n⚠️ ${low} məhsul minimum qalıqdan aşağıdır.`, `\n\n⚠️ ${low} products are below minimum stock.`, `\n\n⚠️ ${low} товаров ниже минимума.`) : ''}\n\n${pick(lang, 'Bu, kassanın serverə yazdığı son qalıqdır.', 'This is the latest stock the till synced.', 'Это последний остаток, переданный кассой.')}`,
      links: [link('/pos/app/anbar?tab=goods', 'Portalda anbar', 'Stock in the portal', 'Склад в портале')], chips: ['low_stock_chip', 'stock_view'] };
  }

  if (intent.kind === 'product') {
    const hits = await findOwned(app, customerId, intent.needle);
    if (!hits.length) return { id: 'acc_product_none', text: pick(lang, `«${intent.needle}» üzrə məhsul tapmadım. Adın bir hissəsini və ya barkodu yazın.`, `No product matching “${intent.needle}”. Try part of the name or the barcode.`, `Товар «${intent.needle}» не найден. Напишите часть названия или штрихкод.`) };
    const byName = new Map<string, { qty: number; price: number; cost: number; unit: string; barcode: string; min: number; places: string[] }>();
    for (const h of hits) {
      const e = byName.get(h.name) ?? { qty: 0, price: h.price, cost: h.cost, unit: h.unit, barcode: h.barcode, min: h.min, places: [] };
      e.qty += h.qty; if (h.warehouse) e.places.push(`${h.warehouse}: ${h.qty}`);
      byName.set(h.name, e);
    }
    const lines = [...byName.entries()].slice(0, 10).map(([name, e]) => {
      const low = e.min > 0 && e.qty <= e.min ? pick(lang, ' ⚠️ az qalıb', ' ⚠️ low', ' ⚠️ мало') : '';
      return `• ${name}${e.barcode ? ` (${e.barcode})` : ''}: ${e.qty} ${e.unit}${low}\n  ${pick(lang, 'Satış', 'Price', 'Цена')}: ${azn(e.price)}${e.cost ? ` · ${pick(lang, 'maya', 'cost', 'себест.')}: ${azn(e.cost)}` : ''}${e.places.length > 1 ? `\n  ${e.places.join(' · ')}` : ''}`;
    });
    return { id: 'acc_product', text: `${lines.join('\n')}\n\n${pick(lang, 'Bu, kassanın serverə yazdığı son qalıqdır.', 'This is the latest stock the till synced.', 'Это последний остаток, переданный кассой.')}`, chips: ['stock_view'] };
  }

  if (intent.kind === 'stock_value') {
    const [v] = rows(await app.db.execute(sql`
      SELECT COALESCE(SUM(b.qty * COALESCE((p.payload->>'priceMinor')::numeric,0)),0) AS sale,
             COALESCE(SUM(b.qty * COALESCE((p.payload->>'costMinor')::numeric,0)),0) AS cost,
             COUNT(DISTINCT p.product_id) AS products, COALESCE(SUM(b.qty),0) AS units
      FROM market_products p JOIN market_stock_balances b ON b.customer_id=p.customer_id AND b.product_id=p.product_id
      WHERE p.customer_id=${customerId}::uuid AND b.qty > 0`));
    return { id: 'acc_stock_value', text: pick(lang,
      `Anbarın dəyəri (son sinxron qalığa görə):\n• Satış qiyməti ilə: ${azn(num(v?.sale))}\n• Maya dəyəri ilə: ${azn(num(v?.cost))}\n• Gözlənilən mənfəət: ${azn(num(v?.sale) - num(v?.cost))}\n• ${num(v?.products)} məhsul, cəmi ${num(v?.units)} vahid`,
      `Stock value (latest synced quantities):\n• At sale price: ${azn(num(v?.sale))}\n• At cost: ${azn(num(v?.cost))}\n• Expected margin: ${azn(num(v?.sale) - num(v?.cost))}\n• ${num(v?.products)} products, ${num(v?.units)} units`,
      `Стоимость склада (по последним остаткам):\n• По цене продажи: ${azn(num(v?.sale))}\n• По себестоимости: ${azn(num(v?.cost))}\n• Ожидаемая маржа: ${azn(num(v?.sale) - num(v?.cost))}\n• ${num(v?.products)} товаров, ${num(v?.units)} ед.`), chips: ['low_stock_chip'] };
  }

  const snaps = await marketSnapshots(app, customerId);
  const fresh = snaps.filter((s) => isToday(s.updatedAt));

  if (intent.kind === 'low') {
    const items = new Map<string, Row>();
    for (const s of snaps) for (const it of s.lowStock) items.set(String(it.id ?? it.name), { ...it, branch: s.name });
    if (!items.size) return { id: 'acc_low', text: pick(lang, 'Kassaların son məlumatına görə minimum qalıqdan aşağı düşən mal yoxdur. (Minimum qalıq məhsul kartında yazılır.)', 'According to the latest till data, nothing is below its minimum stock. (Minimum stock is set on the product card.)', 'По последним данным касс ничего не ниже минимального остатка. (Минимум задаётся в карточке товара.)'), chips: ['replenish'] };
    const lines = [...items.values()].slice(0, 15).map((it) => `• ${it.name}: ${num(it.stock)} / min ${num(it.minStock)}${snaps.length > 1 ? ` (${it.branch})` : ''}`);
    return { id: 'acc_low', text: `${pick(lang, 'Az qalan mallar', 'Low stock', 'Заканчивается')} (${items.size}):\n${lines.join('\n')}`, chips: ['purchase', 'replenish'] };
  }

  if (intent.kind === 'top') {
    const period = intent.period ?? 'month';
    const live = await liveSales(app, customerId, market, period);
    if (live) {
      if (!live.top.length) return { id: 'acc_top', text: pick(lang, `${periodName(period, lang)} satış qeydə alınmayıb.`, `No sales recorded: ${periodName(period, lang).toLowerCase()}.`, `${periodName(period, lang)} продаж нет.`), chips: intent.period ? [] : ['acc_profit_chip'] };
      return { id: 'acc_top', text: `${pick(lang, 'Ən çox satılan mallar', 'Best sellers', 'Лидеры продаж')} — ${periodName(period, lang).toLowerCase()}:\n${live.top.map((t, i) => `${i + 1}. ${t.name}: ${num(t.quantity)} — ${azn(num(t.totalMinor))}`).join('\n')}${live.offline.length ? `\n\n${pick(lang, 'Oflayn kassalar daxil deyil', 'Offline tills not included', 'Офлайн-кассы не учтены')}: ${live.offline.join(', ')}` : ''}` };
    }
  }

  if (intent.kind === 'top' || intent.kind === 'profit') {
    const online = market.find((d) => branchOnline(d as unknown as Row));
    const goods = online ? await liveGoods(app, customerId, online) : null;
    if (goods) {
      if (intent.kind === 'top') {
        const top = goods.filter((g) => num(g.soldQtyMilli) > 0).sort((a, b) => num(b.soldMinor) - num(a.soldMinor)).slice(0, 10);
        if (!top.length) return { id: 'acc_top', text: pick(lang, 'Kassada satış qeydi hələ yoxdur.', 'No sales recorded on the till yet.', 'Продаж на кассе пока нет.') };
        return { id: 'acc_top', text: `${pick(lang, 'Ən çox satılan mallar (kassanın hesabat dövrü üzrə)', 'Best sellers (till reporting period)', 'Лидеры продаж (отчётный период кассы)')}:\n${top.map((g, i) => `${i + 1}. ${g.name}: ${num(g.soldQtyMilli) / 1000} ${g.unit ?? ''} — ${azn(num(g.soldMinor))}`).join('\n')}` };
      }
      const sold = goods.reduce((s, g) => s + num(g.soldMinor), 0);
      const profit = goods.reduce((s, g) => s + num(g.soldProfitMinor), 0);
      const noCost = goods.filter((g) => num(g.soldQtyMilli) > 0 && !num(g.costMinor)).length;
      const today = fresh.reduce((s, x) => s + x.sales, 0);
      return { id: 'acc_profit', text: pick(lang,
        `${intent.period !== 'today' ? 'Dünən, həftə və ay üzrə ayrıca qazanc kassanın Hesabatlar bölməsindədir (tarix aralığı ilə). Kassanın cari hesabat dövrü:\n\n' : ''}Kassanın hesabat dövrü üzrə (${online!.name}):\n• Satış: ${azn(sold)}\n• Mənfəət (satış − maya): ${azn(profit)}${sold ? ` (${Math.round((profit / sold) * 100)}%)` : ''}\n• Bu günün satışı: ${azn(today)}${noCost ? `\n\n⚠️ ${noCost} satılmış məhsulda maya qiyməti yoxdur — onların qazancı tam görünmür.` : ''}\n\nTarix aralığı ilə dəqiq qazanc üçün kassada Hesabatlar → mənfəət bölməsinə baxın.`,
        `Till reporting period (${online!.name}):\n• Sales: ${azn(sold)}\n• Profit (sales − cost): ${azn(profit)}${sold ? ` (${Math.round((profit / sold) * 100)}%)` : ''}\n• Today’s sales: ${azn(today)}${noCost ? `\n\n⚠️ ${noCost} sold products have no cost price, so their profit is incomplete.` : ''}\n\nFor profit by date range use Reports → profit on the till.`,
        `За отчётный период кассы (${online!.name}):\n• Продажи: ${azn(sold)}\n• Прибыль (продажи − себестоимость): ${azn(profit)}${sold ? ` (${Math.round((profit / sold) * 100)}%)` : ''}\n• Продажи сегодня: ${azn(today)}${noCost ? `\n\n⚠️ У ${noCost} проданных товаров нет себестоимости — их прибыль неполная.` : ''}\n\nПрибыль по датам — Отчёты → прибыль на кассе.`), chips: ['profit_howto'] };
    }
    const today = fresh.reduce((s, x) => s + x.sales, 0);
    return { id: `acc_${intent.kind}`, text: pick(lang,
      `${intent.kind === 'top' ? 'Ən çox satılanları' : 'Qazancı (satış − maya)'} kassanın özü hesablayır və bunun üçün kassa indi onlayn olmalıdır — hazırda kassalarınız oflayndır.\n\nServerdəki son məlumat: bu günün satışı ${azn(today)}${fresh.length ? '' : ' (bu gün sinxron gəlməyib)'}.\n\nKassanı açıb internetə qoşun və yenidən soruşun, ya da kassada Hesabatlar bölməsinə baxın.`,
      `${intent.kind === 'top' ? 'Best sellers are' : 'Profit (sales − cost) is'} calculated by the till itself, which must be online — your tills are offline right now.\n\nLatest server data: today’s sales ${azn(today)}${fresh.length ? '' : ' (no sync today)'}.\n\nOpen the till online and ask again, or check Reports on the till.`,
      `${intent.kind === 'top' ? 'Лидеров продаж' : 'Прибыль (продажи − себестоимость)'} считает сама касса, она должна быть онлайн — сейчас кассы офлайн.\n\nПоследние данные сервера: продажи сегодня ${azn(today)}${fresh.length ? '' : ' (сегодня синхронизации не было)'}.\n\nВключите кассу с интернетом и спросите снова или откройте Отчёты на кассе.`), chips: ['devices_status', 'reports'] };
  }

  if (intent.kind === 'cash') {
    const online = market.find((d) => branchOnline(d as unknown as Row));
    const data = online ? await liveCall(app, customerId, online, 'cashAccounts.list') : null;
    const accounts = Array.isArray(data?.accounts) ? data!.accounts as Row[] : [];
    if (accounts.length) {
      const lines = accounts.map((a) => `• ${a.name}: ${azn(num(a.balanceMinor))}${num(a.todayCashMinor) || num(a.todayCardMinor) ? ` (${pick(lang, 'bu gün', 'today', 'сегодня')}: ${pick(lang, 'nağd', 'cash', 'нал.')} ${azn(num(a.todayCashMinor))}, ${pick(lang, 'kart', 'card', 'карта')} ${azn(num(a.todayCardMinor))})` : ''}`);
      const sum = accounts.reduce((s, a) => s + num(a.balanceMinor), 0);
      return { id: 'acc_cash', text: `${pick(lang, 'Kassa və bank hesablarının qalığı (kassadan canlı)', 'Cash and bank account balances (live from the till)', 'Остатки кассовых и банковских счетов (с кассы онлайн)')}:\n${lines.join('\n')}\n\n${pick(lang, 'Cəmi', 'Total', 'Итого')}: ${azn(sum)}`, chips: ['cash_accounts'] };
    }
  }

  if (intent.kind === 'sales' || intent.kind === 'checks') {
    const live = await liveSales(app, customerId, market, intent.period);
    if (live) {
      const avg = live.count ? Math.round(live.total / live.count) : 0;
      const text = pick(lang,
        `${periodName(intent.period, lang)} satış (kassadan canlı): ${azn(live.total)}\n• Nağd: ${azn(live.cash)} · Kart: ${azn(live.card)}${live.account ? ` · Borca: ${azn(live.account)}` : ''}\n• Çek sayı: ${live.count}${avg ? ` · orta çek: ${azn(avg)}` : ''}${live.discount ? `\n• Endirim: ${azn(live.discount)}` : ''}${live.refunds ? `\n• Qaytarma: ${azn(live.refunds)}` : ''}`,
        `${periodName(intent.period, lang)} sales (live from the till): ${azn(live.total)}\n• Cash: ${azn(live.cash)} · Card: ${azn(live.card)}${live.account ? ` · On credit: ${azn(live.account)}` : ''}\n• Receipts: ${live.count}${avg ? ` · average: ${azn(avg)}` : ''}${live.discount ? `\n• Discounts: ${azn(live.discount)}` : ''}${live.refunds ? `\n• Refunds: ${azn(live.refunds)}` : ''}`,
        `${periodName(intent.period, lang)} продажи (с кассы онлайн): ${azn(live.total)}\n• Наличные: ${azn(live.cash)} · Карта: ${azn(live.card)}${live.account ? ` · В долг: ${azn(live.account)}` : ''}\n• Чеков: ${live.count}${avg ? ` · средний чек: ${azn(avg)}` : ''}${live.discount ? `\n• Скидки: ${azn(live.discount)}` : ''}${live.refunds ? `\n• Возвраты: ${azn(live.refunds)}` : ''}`);
      const off = live.offline.length ? `\n\n${pick(lang, 'Oflayn kassalar daxil deyil', 'Offline tills not included', 'Офлайн-кассы не учтены')}: ${live.offline.join(', ')}` : '';
      const branches = live.branches.length > 1 ? `\n${pick(lang, 'Filiallar', 'Branches', 'Филиалы')}: ${live.branches.join(', ')}` : '';
      return { id: `acc_${intent.kind}`, text: text + branches + off, chips: ['acc_profit_chip', 'top_chip'] };
    }
  }

  // sales / cash / checks — today's snapshot per till.
  if (!snaps.length) return { id: 'acc_sales', text: pick(lang, 'Kassalarınızdan serverə hələ satış məlumatı gəlməyib. Kassanı açıq və internetə bağlı saxlayın.', 'No sales data has reached the server from your tills yet. Keep the till open and online.', 'С касс ещё не поступали данные о продажах. Держите кассу открытой и онлайн.') };
  const period = 'period' in intent ? intent.period : 'today';
  const total = fresh.reduce((a, s) => ({ sales: a.sales + s.sales, cash: a.cash + s.cash, card: a.card + s.card, count: a.count + s.count }), { sales: 0, cash: 0, card: 0, count: 0 });
  const perTill = snaps.map((s) => `• ${s.name}: ${isToday(s.updatedAt) ? `${azn(s.sales)} · ${s.count} ${pick(lang, 'çek', 'receipts', 'чеков')}` : pick(lang, 'bu gün məlumat yoxdur', 'no data today', 'сегодня нет данных')} (${pick(lang, 'yeniləndi', 'updated', 'обновлено')} ${when(s.updatedAt, lang)})`);
  const avg = total.count ? Math.round(total.sales / total.count) : 0;
  const note = period === 'today' ? '' : pick(lang,
    '\n\nServer yalnız bu günün canlı rəqəmini saxlayır. Dünən, həftə və ay üzrə satış kassada Hesabatlar bölməsində tarix aralığı ilə görünür.',
    '\n\nThe server keeps only today’s live numbers. Yesterday, week and month are in Reports on the till by date range.',
    '\n\nСервер хранит только сегодняшние цифры. Вчера, неделя и месяц — в Отчётах на кассе по периоду.');
  const head = intent.kind === 'cash'
    ? pick(lang, `Bu gün kassalara daxil olan: nağd ${azn(total.cash)}, kart ${azn(total.card)}.\n(Kassanın cari nağd qalığı açılış məbləği və pul çıxarışlarından da asılıdır — kassada Kassa bölməsinə baxın.)`, `Taken today: cash ${azn(total.cash)}, card ${azn(total.card)}.\n(The till’s cash balance also depends on the float and withdrawals — see Cash on the till.)`, `Сегодня поступило: наличные ${azn(total.cash)}, карта ${azn(total.card)}.\n(Остаток наличных зависит и от размена и изъятий — см. Касса на кассе.)`)
    : pick(lang, `Bu günün satışı: ${azn(total.sales)}\n• Nağd: ${azn(total.cash)} · Kart: ${azn(total.card)}\n• Çek sayı: ${total.count}${avg ? ` · orta çek: ${azn(avg)}` : ''}`, `Today’s sales: ${azn(total.sales)}\n• Cash: ${azn(total.cash)} · Card: ${azn(total.card)}\n• Receipts: ${total.count}${avg ? ` · average: ${azn(avg)}` : ''}`, `Продажи сегодня: ${azn(total.sales)}\n• Наличные: ${azn(total.cash)} · Карта: ${azn(total.card)}\n• Чеков: ${total.count}${avg ? ` · средний чек: ${azn(avg)}` : ''}`);
  const restNote = restaurant.length ? pick(lang, '\n\nRestoran kassanız üçün “satış” yazın.', '\n\nFor your restaurant till, type “satış”.', '\n\nДля ресторанной кассы напишите «satış».') : '';
  return { id: `acc_${intent.kind}`, text: `${head}\n\n${perTill.join('\n')}${note}${restNote}`, chips: ['acc_profit_chip', 'low_stock_chip'] };
}

type Owned = { name: string; qty: number; warehouse: string; barcode: string; price: number; cost: number; unit: string; min: number };

/** Owner's market products by name or barcode, with any Azerbaijani case suffix tried off. */
async function findOwned(app: FastifyInstance, customerId: string, needle: string): Promise<Owned[]> {
  const variants = new Set<string>([needle]);
  const w = needle.replace(/(nin|nun|in|un|ni|nu|i|u|da|de|dan|den|ya|ye|lar|ler)$/, '');
  if (w.length >= 2) variants.add(w);
  for (const v of variants) {
    const like = `%${v.replace(/[%_]/g, '')}%`;
    const list = rows(await app.db.execute(sql`
      SELECT p.payload, COALESCE(b.qty, (p.payload->>'stock')::numeric, 0) AS qty,
             COALESCE(w.payload->>'name', b.warehouse_id, '') AS warehouse
      FROM market_products p
      LEFT JOIN market_stock_balances b ON b.customer_id=p.customer_id AND b.product_id=p.product_id
      LEFT JOIN market_warehouses w ON w.customer_id=p.customer_id AND w.warehouse_id=b.warehouse_id
      WHERE p.customer_id=${customerId}::uuid AND COALESCE((p.payload->>'active')::boolean, true)
        AND (translate(lower(COALESCE(p.payload#>>'{name,az}', p.payload->>'name', '')), 'əıöüşçğ', 'eiouscg') LIKE ${like}
             OR COALESCE(p.payload->>'barcode','') LIKE ${like})
      ORDER BY p.payload#>>'{name,az}' LIMIT 30`));
    if (list.length) {
      return list.map((r) => {
        const p = (r.payload ?? {}) as Row;
        const name = typeof p.name === 'string' ? p.name : String(p.name?.az ?? '');
        return { name, qty: num(r.qty), warehouse: String(r.warehouse ?? ''), barcode: String(p.barcode ?? ''), price: num(p.priceMinor), cost: num(p.costMinor), unit: String(p.unit ?? 'əd'), min: num(p.minStock) };
      });
    }
  }
  return [];
}
