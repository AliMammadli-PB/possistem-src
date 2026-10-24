/**
 * What the bot does with a message it has decided to trust.
 *
 * Questions are answered straight from the live mirror, so they work at 3am
 * with the till switched off. Only actions that change the restaurant's state
 * are handed to the POS, and the two that cost money — closing the day and
 * changing a price — go behind a confirmation code first.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ownerNotifications } from '@milioner/database';
import {
  findTableLive,
  getDeviceStatus,
  getOpenTablesLive,
  getReportLive,
  getSalesLive,
  getStaffLive,
  getTopProductsLive,
  isDeviceOnline,
  searchProductsLive,
  type ProductLiveRow,
} from '../mysql.js';
import * as fmt from './format.js';
import { fold, parseCommand, type ParsedCommand } from './parser.js';
import {
  clearConfirmation,
  putConfirmation,
  runOnTill,
  takeConfirmation,
} from './queue.js';

export type BotSettings = {
  botEnabled: boolean;
  permissions: { read: boolean; reports: boolean; catalog: boolean; alerts: boolean };
  adminName: string;
};

export type BotContext = {
  app: FastifyInstance;
  customerId: string;
  /** Normalised sender, already checked against the allow list. */
  from: string;
  settings: BotSettings;
  send: (text: string) => Promise<void>;
};

const OFFLINE =
  '🔴 Kassa oflayndır — bu əmr üçün kassa proqramı açıq olmalıdır.\n' +
  'Aşağıdakı əmrlər onlayn olmasa da işləyir: `SATIŞ`, `MASALAR`, `SON HESABAT`.';

/** Core error codes mapped to something an owner can act on. */
function explainError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'E_UNAUTHORIZED':
      return 'Kassada heç kim giriş etməyib — əvvəlcə kassadan daxil olun.';
    case 'E_FORBIDDEN':
      return `Kassadakı istifadəçinin icazəsi çatmır. ${message ?? ''}`.trim();
    case 'E_LICENSE_EXPIRED':
    case 'E_LICENSE_REQUIRED':
      return 'Lisenziya problemi var — kassadan lisenziyanı yoxlayın.';
    case 'E_NOT_FOUND':
      return message ?? 'Tapılmadı.';
    default:
      return message ?? 'Əməliyyat alınmadı.';
  }
}

async function tillOnline(customerId: string): Promise<boolean> {
  const device = await getDeviceStatus(customerId);
  return Boolean(device && isDeviceOnline(device.last_seen_at, device.connected));
}

/** The live numbers, shaped like a report — what the owner gets when the till is asleep. */
async function liveReportFallback(customerId: string, note: string): Promise<string> {
  const sales = await getSalesLive(customerId);
  const open = await getOpenTablesLive(customerId);
  const openTotal =
    open.reduce((sum, t) => sum + Number(t.due_minor || 0), 0) ||
    Number(sales?.open_total_minor ?? 0);
  const openCount = open.length || Number(sales?.open_tables ?? 0);
  const body = fmt.report({
    kind: 'x',
    totals: {
      grossMinor: Number(sales?.gross_minor ?? 0),
      netMinor: Number(sales?.net_minor ?? 0),
      openTableCount: openCount,
      openTablesTotalMinor: openTotal,
    },
    canonical: {
      businessDate: sales?.business_date ?? undefined,
      sales: {
        grossMinor: Number(sales?.gross_minor ?? 0),
        netMinor: Number(sales?.net_minor ?? 0),
        tipsMinor: Number(sales?.tips_minor ?? 0),
        refundMinor: Number(sales?.refund_minor ?? 0),
        byMethod: [
          { method: 'cash', totalMinor: Number(sales?.cash_minor ?? 0) },
          { method: 'card', totalMinor: Number(sales?.card_minor ?? 0) },
        ],
      },
      orders: {
        count: Number(sales?.order_count ?? 0),
        discountMinor: Number(sales?.discount_minor ?? 0),
        taxMinor: Number(sales?.tax_minor ?? 0),
        serviceMinor: Number(sales?.service_minor ?? 0),
      },
    },
    live: true,
  });
  return `${body}\n\n⚠️ ${note}`;
}

/** Narrows a search to one product, or explains why it could not. */
async function resolveProduct(
  customerId: string,
  needle: string,
): Promise<{ product: ProductLiveRow } | { reply: string }> {
  const matches = await searchProductsLive(customerId, needle, 8);
  if (matches.length === 0) {
    return { reply: `🔍 "${needle}" üzrə məhsul tapılmadı. Adın bir hissəsini yazın.` };
  }
  const exact = matches.filter((m) => fmtName(m.name) === fmtName(needle));
  if (exact.length === 1) return { product: exact[0]! };
  if (matches.length > 1) {
    return {
      reply: [
        `🔍 "${needle}" üçün ${matches.length} nəticə var — daha dəqiq yazın:`,
        '',
        ...matches.map((m) => `• ${m.name} — ${fmt.money(m.price_minor)}`),
      ].join('\n'),
    };
  }
  return { product: matches[0]! };
}

/** Same folding as the parser, so "Çay" typed as "cay" still matches exactly. */
function fmtName(value: string): string {
  return fold(value);
}

export async function handleBotMessage(ctx: BotContext, text: string): Promise<void> {
  const command = parseCommand(text);

  // A confirmation answer is handled before anything else so a stray "1234"
  // can never be read as a new command.
  if (command.kind === 'confirm') {
    const pending = takeConfirmation(ctx.customerId, ctx.from, command.code);
    if (!pending) {
      await ctx.send('⌛ Təsdiq gözlənilmir və ya kod köhnəlib. Əmri yenidən yazın.');
      return;
    }
    await runConfirmed(ctx, pending.command);
    return;
  }

  if (command.kind === 'cancel') {
    const had = clearConfirmation(ctx.customerId, ctx.from);
    await ctx.send(had ? '✅ Ləğv edildi.' : 'Ləğv ediləcək əmr yoxdur.');
    return;
  }

  if (!ctx.settings.botEnabled) {
    await ctx.send('🤖 Bot əmrləri kassadan söndürülüb (Parametrlər → WhatsApp).');
    return;
  }

  switch (command.kind) {
    case 'help':
      await ctx.send(fmt.help(ctx.settings.permissions.catalog));
      return;

    case 'unknown':
      await ctx.send(
        `🤔 "${command.text}" tanınmadı.\n\n${fmt.help(ctx.settings.permissions.catalog)}`,
      );
      return;

    default:
      break;
  }

  if (!ctx.settings.permissions.read && isReadCommand(command)) {
    await ctx.send('🤖 Məlumat əmrləri söndürülüb.');
    return;
  }

  switch (command.kind) {
    case 'tables': {
      const rows = await getOpenTablesLive(ctx.customerId);
      const sales = await getSalesLive(ctx.customerId);
      await ctx.send(fmt.tables(rows, sales?.updated_at));
      return;
    }

    case 'table': {
      const rows = await findTableLive(ctx.customerId, command.needle, command.area);
      const shown = command.area
        ? `${command.needle} (${command.area})`
        : command.needle;
      if (rows.length === 0) {
        await ctx.send(`🍽 "${shown}" masası tapılmadı.`);
        return;
      }
      if (rows.length > 1) {
        await ctx.send(
          [
            '🍽 Bir neçə masa uyğun gəldi — zalı da yazın (`masa 1 zal`):',
            '',
            ...rows.map((r) => `• *${r.label}*${r.area_name ? ` · ${r.area_name}` : ''}`),
          ].join('\n'),
        );
        return;
      }
      await ctx.send(fmt.tableDetail(rows[0]!));
      return;
    }

    case 'sales':
      await ctx.send(fmt.sales(await getSalesLive(ctx.customerId)));
      return;

    case 'summary': {
      const [sales, open] = await Promise.all([
        getSalesLive(ctx.customerId),
        getOpenTablesLive(ctx.customerId),
      ]);
      await ctx.send(fmt.summary(sales, open));
      return;
    }

    case 'status': {
      const device = await getDeviceStatus(ctx.customerId);
      await ctx.send(
        fmt.status({
          online: Boolean(device && isDeviceOnline(device.last_seen_at, device.connected)),
          restaurantName: device?.restaurant_name,
          appVersion: device?.app_version,
          lastSeenAt: device?.last_seen_at,
          staff: await getStaffLive(ctx.customerId),
          sales: await getSalesLive(ctx.customerId),
        }),
      );
      return;
    }

    case 'staff':
      await ctx.send(fmt.staff(await getStaffLive(ctx.customerId)));
      return;

    case 'top':
      await ctx.send(fmt.topProducts(await getTopProductsLive(ctx.customerId, 10)));
      return;

    case 'product': {
      const rows = await searchProductsLive(ctx.customerId, command.needle, 10);
      await ctx.send(fmt.products(rows, command.needle));
      return;
    }

    case 'lastReport':
      await ctx.send(fmt.lastReports(await getReportLive(ctx.customerId)));
      return;

    case 'history':
      await ctx.send(await historyReply(ctx, command.date));
      return;

    case 'xReport':
      await runXReport(ctx);
      return;

    case 'zReport':
      await startZReport(ctx);
      return;

    case 'price':
    case 'soldOut':
      await runCatalogCommand(ctx, command);
      return;

    default:
      await ctx.send(fmt.help(ctx.settings.permissions.catalog));
  }
}

function isReadCommand(command: ParsedCommand): boolean {
  return [
    'tables',
    'table',
    'sales',
    'summary',
    'status',
    'staff',
    'top',
    'product',
  ].includes(command.kind);
}

async function historyReply(ctx: BotContext, date: string): Promise<string> {
  const rows = await ctx.app.db
    .select()
    .from(ownerNotifications)
    .where(
      and(
        eq(ownerNotifications.customerId, ctx.customerId),
        sql`${ownerNotifications.kind} IN ('x_report','z_report')`,
        sql`${ownerNotifications.payload}->>'businessDate' = ${date}`,
      ),
    )
    .orderBy(desc(ownerNotifications.createdAt))
    .limit(4);

  if (rows.length === 0) return `📄 ${date} tarixinə hesabat tapılmadı.`;

  return rows
    .map((row) => {
      const payload = (row.payload ?? {}) as {
        kind?: string;
        totals?: Record<string, unknown>;
        sequenceNo?: number;
      };
      const totals = (payload.totals ?? {}) as Record<string, unknown>;
      const canonical = (totals.canonical ?? {}) as Record<string, unknown>;
      return fmt.report({
        kind: payload.kind === 'z' ? 'z' : 'x',
        sequenceNo: payload.sequenceNo,
        totals: totals as never,
        canonical: (Object.keys(canonical).length > 0 ? canonical : { businessDate: date }) as never,
      });
    })
    .join('\n\n────────\n\n');
}

async function runXReport(ctx: BotContext): Promise<void> {
  if (!ctx.settings.permissions.reports) {
    await ctx.send('🤖 Hesabat əmrləri söndürülüb.');
    return;
  }
  if (!(await tillOnline(ctx.customerId))) {
    await ctx.send(
      await liveReportFallback(
        ctx.customerId,
        'Kassa oflayndır — rəsmi X hesabatı çıxarıla bilmədi, çek çap olunmayıb.',
      ),
    );
    return;
  }

  // reports.x silently opens a business day when none is open. Doing that from
  // a text message would move the accounting boundary, so the live figures are
  // sent instead.
  const sales = await getSalesLive(ctx.customerId);
  if (sales?.business_day_status && sales.business_day_status !== 'open') {
    await ctx.send(
      await liveReportFallback(
        ctx.customerId,
        'Kassa günü bağlıdır — rəsmi X üçün kassada gün açılmalıdır.',
      ),
    );
    return;
  }

  await ctx.send('⏳ X hesabatı hazırlanır…');
  const outcome = await runOnTill({
    customerId: ctx.customerId,
    command: 'report.x',
    requestedBy: ctx.from,
  });

  if (outcome.timedOut) {
    await ctx.send(
      await liveReportFallback(ctx.customerId, 'Kassa vaxtında cavab vermədi.'),
    );
    return;
  }
  if (!outcome.ok) {
    await ctx.send(`❌ ${explainError(outcome.errorCode, outcome.error)}`);
    return;
  }

  const data = (outcome.result ?? {}) as {
    totals?: Record<string, unknown>;
    canonical?: Record<string, unknown>;
    sequenceNo?: number;
  };
  await ctx.send(
    `${fmt.report({
      kind: 'x',
      sequenceNo: data.sequenceNo,
      totals: data.totals as never,
      canonical: data.canonical as never,
    })}\n\n🖨 Kassada çek çap olundu.`,
  );
}

async function startZReport(ctx: BotContext): Promise<void> {
  if (!ctx.settings.permissions.reports) {
    await ctx.send('🤖 Hesabat əmrləri söndürülüb.');
    return;
  }
  if (!(await tillOnline(ctx.customerId))) {
    await ctx.send(OFFLINE);
    return;
  }

  await ctx.send('⏳ Gün bağlanışı yoxlanılır…');
  const check = await runOnTill({
    customerId: ctx.customerId,
    command: 'report.readiness',
    requestedBy: ctx.from,
  });

  if (check.timedOut) {
    await ctx.send('⌛ Kassa cavab vermədi — bir azdan yenidən yoxlayın.');
    return;
  }
  if (!check.ok) {
    await ctx.send(`❌ ${explainError(check.errorCode, check.error)}`);
    return;
  }

  const readiness = (check.result ?? {}) as {
    ready?: boolean;
    openOrders?: number;
    unresolvedPayments?: number;
    pendingKitchen?: number;
    blockers?: { code?: string; message?: string; count?: number }[];
  };

  if (!readiness.ready) {
    await ctx.send(
      [
        '🚫 *Gün bağlana bilməz*',
        '',
        ...(readiness.blockers ?? []).map(
          (b) => `• ${b.message ?? b.code ?? 'maneə'}${b.count ? ` (${b.count})` : ''}`,
        ),
        '',
        readiness.openOrders ? `Açıq sifariş: ${readiness.openOrders}` : null,
        readiness.unresolvedPayments
          ? `Həll olunmamış ödəniş: ${readiness.unresolvedPayments}`
          : null,
        readiness.pendingKitchen ? `Mətbəxdə gözləyən: ${readiness.pendingKitchen}` : null,
        '',
        '_Maneələr aradan qalxandan sonra yenidən `Z HESABAT` yazın._',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    );
    return;
  }

  const sales = await getSalesLive(ctx.customerId);
  const code = putConfirmation(ctx.customerId, ctx.from, { kind: 'zReport' }, 'Z hesabat');
  await ctx.send(
    [
      '🧾 *Z hesabat — təsdiq lazımdır*',
      '',
      sales?.business_date ? `İş günü: ${sales.business_date}` : null,
      `Dövriyyə: *${fmt.money(sales?.gross_minor)}*`,
      `Sifariş: ${sales?.order_count ?? 0} · Ödəniş: ${sales?.payment_count ?? 0}`,
      '',
      '⚠️ Bu əməliyyat iş gününü *bağlayır* və geri qaytarıla bilmir.',
      '',
      `Təsdiq üçün *${code}* yazın (5 dəqiqə keçərlidir).`,
      'İmtina üçün `LƏĞV` yazın.',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  );
}

async function runCatalogCommand(ctx: BotContext, command: ParsedCommand): Promise<void> {
  if (!ctx.settings.permissions.catalog) {
    await ctx.send(
      '🔒 Katalog əmrləri söndürülüb.\nKassada Parametrlər → WhatsApp bölməsindən aça bilərsiniz.',
    );
    return;
  }
  if (!(await tillOnline(ctx.customerId))) {
    await ctx.send(OFFLINE);
    return;
  }

  if (command.kind === 'soldOut') {
    const found = await resolveProduct(ctx.customerId, command.needle);
    if ('reply' in found) {
      await ctx.send(found.reply);
      return;
    }
    const outcome = await runOnTill({
      customerId: ctx.customerId,
      command: 'catalog.soldOut',
      args: { productId: found.product.product_id, soldOut: command.soldOut },
      requestedBy: ctx.from,
    });
    if (outcome.timedOut) {
      await ctx.send('⌛ Kassa cavab vermədi.');
      return;
    }
    if (!outcome.ok) {
      await ctx.send(`❌ ${explainError(outcome.errorCode, outcome.error)}`);
      return;
    }
    await ctx.send(
      command.soldOut
        ? `⛔ *${found.product.name}* bitib olaraq işarələndi.`
        : `✅ *${found.product.name}* yenidən satışdadır.`,
    );
    return;
  }

  if (command.kind === 'price') {
    const found = await resolveProduct(ctx.customerId, command.needle);
    if ('reply' in found) {
      await ctx.send(found.reply);
      return;
    }
    const code = putConfirmation(ctx.customerId, ctx.from, command, 'Qiymət dəyişikliyi');
    await ctx.send(
      [
        '✏️ *Qiymət dəyişikliyi — təsdiq lazımdır*',
        '',
        `Məhsul: *${found.product.name}*`,
        `Köhnə qiymət: ${fmt.money(found.product.price_minor)}`,
        `Yeni qiymət: *${fmt.money(command.priceMinor)}*`,
        '',
        `Təsdiq üçün *${code}* yazın (5 dəqiqə keçərlidir).`,
        'İmtina üçün `LƏĞV` yazın.',
      ].join('\n'),
    );
  }
}

/** Runs an action the owner has just confirmed with a code. */
async function runConfirmed(ctx: BotContext, command: ParsedCommand): Promise<void> {
  if (command.kind === 'zReport') {
    await ctx.send('⏳ Gün bağlanır…');
    const outcome = await runOnTill({
      customerId: ctx.customerId,
      command: 'report.z',
      requestedBy: ctx.from,
      timeoutMs: 60_000,
    });
    if (outcome.timedOut) {
      await ctx.send('⌛ Kassa cavab vermədi — bağlanışın baş tutduğunu kassadan yoxlayın.');
      return;
    }
    if (!outcome.ok) {
      await ctx.send(`❌ ${explainError(outcome.errorCode, outcome.error)}`);
      return;
    }
    const data = (outcome.result ?? {}) as {
      totals?: Record<string, unknown>;
      canonical?: Record<string, unknown>;
      sequenceNo?: number;
    };
    await ctx.send(
      `${fmt.report({
        kind: 'z',
        sequenceNo: data.sequenceNo,
        totals: data.totals as never,
        canonical: data.canonical as never,
      })}\n\n🖨 Kassada çek çap olundu.`,
    );
    return;
  }

  if (command.kind === 'price') {
    const found = await resolveProduct(ctx.customerId, command.needle);
    if ('reply' in found) {
      await ctx.send(found.reply);
      return;
    }
    const outcome = await runOnTill({
      customerId: ctx.customerId,
      command: 'catalog.price',
      args: {
        productId: found.product.product_id,
        priceMinor: command.priceMinor,
        name: found.product.name,
      },
      requestedBy: ctx.from,
    });
    if (outcome.timedOut) {
      await ctx.send('⌛ Kassa cavab vermədi.');
      return;
    }
    if (!outcome.ok) {
      await ctx.send(`❌ ${explainError(outcome.errorCode, outcome.error)}`);
      return;
    }
    await ctx.send(
      [
        '✅ *Qiymət dəyişdirildi*',
        '',
        `${found.product.name}`,
        `${fmt.money(found.product.price_minor)} → *${fmt.money(command.priceMinor)}*`,
        '',
        '_Dəyişiklik qiymət tarixçəsinə yazıldı._',
      ].join('\n'),
    );
    return;
  }

  await ctx.send('Təsdiq edilən əmr tapılmadı.');
}
