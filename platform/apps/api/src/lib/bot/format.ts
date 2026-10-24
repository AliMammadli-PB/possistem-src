/**
 * Azerbaijani text for everything the bot says.
 *
 * Kept apart from the command logic so the wording can be tuned without
 * touching behaviour, and so a reply can be unit-tested as a plain string.
 * WhatsApp markdown: *bold*, _italic_, ```mono```.
 */
import type {
  ProductLiveRow,
  ReportLiveRow,
  SalesLiveRow,
  StaffLiveRow,
  TableLiveRow,
} from '../mysql.js';

/** 123456 -> "1 234,56 AZN". Same rules as the owner web's formatMoney. */
export function money(minor: number | null | undefined): string {
  const value = Math.trunc(Number(minor) || 0);
  const negative = value < 0;
  const abs = Math.abs(value);
  const manat = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const qepik = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${manat},${qepik} AZN`;
}

/** "3 dəqiqə əvvəl" — how stale the mirror is, in words. */
export function since(at: Date | string | null | undefined): string {
  if (!at) return 'məlumat yoxdur';
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(t)) return 'məlumat yoxdur';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 15) return 'indi';
  if (sec < 90) return `${sec} saniyə əvvəl`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} dəqiqə əvvəl`;
  const hour = Math.round(min / 60);
  if (hour < 36) return `${hour} saat əvvəl`;
  return `${Math.round(hour / 24)} gün əvvəl`;
}

export function clock(at: Date | string | null | undefined): string {
  if (!at) return '—';
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('az-AZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Baku',
  });
}

export function help(canCatalog: boolean): string {
  const lines = [
    '*POSSISTEM — bot əmrləri*',
    '',
    '📊 *Hesabat*',
    '• `X HESABAT` — X hesabatı çıxarır və göndərir',
    '• `Z HESABAT` — günü bağlayır (təsdiq kodu ilə)',
    '• `SON HESABAT` — sonuncu X/Z nəticəsi',
    '',
    '🍽 *Zal*',
    '• `MASALAR` — açıq masalar və məbləğləri',
    '• `MASA 5` / `MASA 5 ZAL` — bir masanın detalı',
    '',
    '💰 *Satış*',
    '• `ÜMUMİ` — nağd, kart, gözləyən və yekun',
    '• `SATIŞ` — bugünkü dövriyyə',
    '• `ÇOX SATILAN` — günün ən çox satılanları',
    '',
    'ℹ️ *Sistem*',
    '• `STATUS` — kassa onlayndırmı, kim girib',
    '• `NÖVBƏ` — açıq növbə və işçilər',
    '• `MƏHSUL çay` — qiymət və stok',
  ];
  if (canCatalog) {
    lines.push(
      '',
      '✏️ *Dəyişiklik*',
      '• `QİYMƏT çay 3.50` — qiyməti dəyişir (təsdiq kodu ilə)',
      '• `BİTİB çay` / `VAR çay` — stok bağla/aç',
    );
  }
  lines.push('', '_Böyük-kiçik hərf fərq etmir._');
  return lines.join('\n');
}

export function tables(rows: TableLiveRow[], updatedAt?: Date | string | null): string {
  if (rows.length === 0) {
    return `🍽 *Açıq masa yoxdur*\n_Məlumat: ${since(updatedAt)}_`;
  }
  const total = rows.reduce((sum, r) => sum + Number(r.due_minor || 0), 0);
  const lines = rows.slice(0, 40).map((r) => {
    const guests = Number(r.guest_count) > 0 ? ` · ${r.guest_count} nəfər` : '';
    const waiter = r.waiter_name ? ` · ${r.waiter_name}` : '';
    const paid = Number(r.paid_minor) > 0 ? ` (ödənib ${money(r.paid_minor)})` : '';
    return `• *${r.label}*${guests}${waiter}\n   ${money(r.due_minor)}${paid}`;
  });
  const more = rows.length > 40 ? `\n_… və daha ${rows.length - 40} masa_` : '';
  return [
    `🍽 *Açıq masalar: ${rows.length}*`,
    '',
    lines.join('\n'),
    more,
    '',
    `*Cəmi qalıq: ${money(total)}*`,
    `_Məlumat: ${since(updatedAt)}_`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function tableDetail(row: TableLiveRow): string {
  return [
    `🍽 *${row.label}*`,
    row.area_name ? `Sahə: ${row.area_name}` : null,
    `Status: ${row.status}`,
    Number(row.guest_count) > 0 ? `Qonaq: ${row.guest_count}` : null,
    Number(row.item_count) > 0 ? `Məhsul sayı: ${row.item_count}` : null,
    row.waiter_name ? `Ofisiant: ${row.waiter_name}` : null,
    '',
    `Cəm: *${money(row.total_minor)}*`,
    Number(row.paid_minor) > 0 ? `Ödənilib: ${money(row.paid_minor)}` : null,
    `Qalıq: *${money(row.due_minor)}*`,
    '',
    `_Məlumat: ${since(row.updated_at)}_`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function sales(row: SalesLiveRow | null): string {
  if (!row) return '💰 Hələ satış məlumatı yoxdur.';
  const lines = [
    '💰 *Bugünkü satış*',
    row.business_date ? `Tarix: ${row.business_date}` : null,
    '',
    `Dövriyyə: *${money(row.gross_minor)}*`,
    `Ödənilən: ${money(row.paid_minor)}`,
    Number(row.cash_minor) > 0 ? `  • Nağd: ${money(row.cash_minor)}` : null,
    Number(row.card_minor) > 0 ? `  • Kart: ${money(row.card_minor)}` : null,
    Number(row.discount_minor) > 0 ? `Endirim: ${money(row.discount_minor)}` : null,
    Number(row.refund_minor) > 0 ? `Geri qaytarma: ${money(row.refund_minor)}` : null,
    '',
    `Sifariş: ${row.order_count} · Ödəniş: ${row.payment_count}`,
    Number(row.avg_ticket_minor) > 0 ? `Orta çek: ${money(row.avg_ticket_minor)}` : null,
    Number(row.open_tables) > 0
      ? `Açıq masa: ${row.open_tables} (${money(row.open_total_minor)})`
      : 'Açıq masa yoxdur',
    '',
    `_Məlumat: ${since(row.updated_at)}_`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/**
 * The one-glance answer: what has come in, and what is still on the tables.
 *
 * Cash and card are money already taken. Open tables are not takings yet, so
 * they are kept on their own line and the total is labelled "gözlənilən" —
 * calling it revenue would overstate the day by whatever walks out unpaid.
 */
export function summary(
  row: SalesLiveRow | null,
  openTables: TableLiveRow[],
): string {
  const cash = Number(row?.cash_minor ?? 0);
  const card = Number(row?.card_minor ?? 0);
  const pending = openTables.reduce((sum, t) => sum + Number(t.due_minor || 0), 0);

  return [
    '📊 *ÜMUMİ*',
    row?.business_date ? `Tarix: ${row.business_date}` : null,
    '',
    `💵 Nağd: *${money(cash)}*`,
    `💳 Kart: *${money(card)}*`,
    `🍽 Gözləyən: *${money(pending)}*${
      openTables.length > 0 ? ` (${openTables.length} masa)` : ''
    }`,
    '',
    '━━━━━━━━━━━━━━',
    `💰 *Gözlənilən yekun: ${money(cash + card + pending)}*`,
    '',
    `_Nağd + Kart alınıb · Gözləyən hələ ödənilməyib_`,
    `_Məlumat: ${since(row?.updated_at)}_`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function status(input: {
  online: boolean;
  restaurantName?: string | null;
  appVersion?: string | null;
  lastSeenAt?: Date | string | null;
  staff: StaffLiveRow[];
  sales: SalesLiveRow | null;
}): string {
  const active = input.staff.filter((s) => s.logged_in);
  return [
    `ℹ️ *${input.restaurantName || 'Kassa'}*`,
    '',
    input.online ? '🟢 Kassa onlayndır' : '🔴 Kassa oflayndır',
    `Son əlaqə: ${since(input.lastSeenAt)}`,
    input.appVersion ? `Versiya: ${input.appVersion}` : null,
    '',
    active.length > 0
      ? `👤 Girişdə: ${active.map((s) => `${s.full_name} (${s.role ?? '—'})`).join(', ')}`
      : '👤 Kassada giriş edən yoxdur',
    input.sales?.business_date ? `📅 İş günü: ${input.sales.business_date}` : null,
    input.sales?.business_day_status
      ? `Kassa günü: ${input.sales.business_day_status === 'open' ? 'açıq' : 'bağlı'}`
      : null,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function staff(rows: StaffLiveRow[]): string {
  const active = rows.filter((s) => s.logged_in);
  if (active.length === 0) {
    return '👤 *Növbə*\n\nHazırda kassada giriş edən yoxdur.';
  }
  return [
    '👤 *Növbədə*',
    '',
    ...active.map(
      (s) =>
        `• *${s.full_name}* (${s.role ?? '—'})` +
        (s.logged_in_at ? `\n   giriş: ${clock(s.logged_in_at)}` : '') +
        (s.shift_id ? '\n   növbə açıqdır' : ''),
    ),
  ].join('\n');
}

export function products(rows: ProductLiveRow[], needle: string): string {
  if (rows.length === 0) return `🔍 "${needle}" üzrə məhsul tapılmadı.`;
  return [
    `🔍 *"${needle}" nəticələri*`,
    '',
    ...rows.map((r) => {
      const flag = r.sold_out ? ' ⛔ *bitib*' : '';
      const sold = Number(r.qty_today) > 0 ? ` · bugün ${r.qty_today} ədəd` : '';
      return `• *${r.name}* — ${money(r.price_minor)}${flag}${sold}`;
    }),
  ].join('\n');
}

export function topProducts(rows: ProductLiveRow[]): string {
  if (rows.length === 0) return '📈 Bu gün hələ satış olmayıb.';
  return [
    '📈 *Bu gün ən çox satılanlar*',
    '',
    ...rows.map(
      (r, i) => `${i + 1}. *${r.name}* — ${r.qty_today} ədəd · ${money(r.revenue_today_minor)}`,
    ),
  ].join('\n');
}

type ReportTotals = {
  grossMinor?: number;
  netMinor?: number;
  refundMinor?: number;
  openTableCount?: number;
  openTablesTotalMinor?: number;
  expectedCashMinor?: number;
};

type ReportCanonical = {
  businessDate?: string;
  openingFloatMinor?: number;
  expectedCashMinor?: number;
  sales?: {
    grossMinor?: number;
    netMinor?: number;
    tipsMinor?: number;
    refundMinor?: number;
    refundCount?: number;
    byMethod?: { method?: string; count?: number; totalMinor?: number }[];
  };
  orders?: {
    count?: number;
    revenueMinor?: number;
    discountMinor?: number;
    taxMinor?: number;
    serviceMinor?: number;
  };
  byCategory?: { category?: string; quantity?: number; revenueMinor?: number }[];
  cashDrawer?: {
    openingFloatMinor?: number;
    cashSalesMinor?: number;
    cashInMinor?: number;
    cashOutMinor?: number;
    cashRefundsMinor?: number;
    expectedCashMinor?: number;
  };
};

const METHOD_AZ: Record<string, string> = {
  cash: 'Nağd',
  card: 'Kart',
  mixed: 'Qarışıq',
  transfer: 'Köçürmə',
  gift: 'Hədiyyə',
};

/** Turns a core X/Z snapshot into the message the owner actually reads. */
export function report(input: {
  kind: 'x' | 'z';
  sequenceNo?: number | null;
  totals?: ReportTotals | null;
  canonical?: ReportCanonical | null;
  restaurantName?: string | null;
  live?: boolean;
}): string {
  const t = input.totals ?? {};
  const c = input.canonical ?? {};
  const title = input.kind === 'z' ? 'Z HESABAT — gün bağlandı' : 'X HESABAT';
  const gross = c.sales?.grossMinor ?? t.grossMinor ?? 0;
  const net = c.sales?.netMinor ?? t.netMinor ?? 0;

  const lines: (string | null)[] = [
    `${input.kind === 'z' ? '🧾' : '📊'} *${title}*`,
    input.restaurantName ? `${input.restaurantName}` : null,
    c.businessDate ? `Tarix: ${c.businessDate}` : null,
    input.sequenceNo ? `№ ${input.sequenceNo}` : null,
    '',
    `Dövriyyə: *${money(gross)}*`,
    net && net !== gross ? `Xalis: ${money(net)}` : null,
    c.orders?.discountMinor ? `Endirim: ${money(c.orders.discountMinor)}` : null,
    c.orders?.taxMinor ? `Vergi: ${money(c.orders.taxMinor)}` : null,
    c.orders?.serviceMinor ? `Servis: ${money(c.orders.serviceMinor)}` : null,
    c.sales?.tipsMinor ? `Bəxşiş: ${money(c.sales.tipsMinor)}` : null,
    c.sales?.refundMinor ? `Geri qaytarma: ${money(c.sales.refundMinor)}` : null,
    c.orders?.count != null ? `Sifariş sayı: ${c.orders.count}` : null,
  ];

  const byMethod = (c.sales?.byMethod ?? []).filter((m) => Number(m.totalMinor) > 0);
  if (byMethod.length > 0) {
    lines.push('', '*Ödəniş növləri*');
    for (const m of byMethod) {
      const label = METHOD_AZ[String(m.method ?? '')] ?? m.method ?? '—';
      lines.push(`• ${label}: ${money(m.totalMinor)}${m.count ? ` (${m.count})` : ''}`);
    }
  }

  const cats = (c.byCategory ?? []).filter((x) => Number(x.revenueMinor) > 0).slice(0, 8);
  if (cats.length > 0) {
    lines.push('', '*Kateqoriyalar*');
    for (const x of cats) {
      lines.push(`• ${x.category ?? '—'}: ${money(x.revenueMinor)}${x.quantity ? ` · ${x.quantity} ədəd` : ''}`);
    }
  }

  const drawer = c.cashDrawer;
  if (drawer && (drawer.expectedCashMinor || drawer.cashSalesMinor)) {
    lines.push(
      '',
      '*Kassa*',
      drawer.openingFloatMinor ? `Açılış: ${money(drawer.openingFloatMinor)}` : null,
      drawer.cashSalesMinor ? `Nağd satış: ${money(drawer.cashSalesMinor)}` : null,
      drawer.cashInMinor ? `Mədaxil: ${money(drawer.cashInMinor)}` : null,
      drawer.cashOutMinor ? `Məxaric: ${money(drawer.cashOutMinor)}` : null,
      `Gözlənilən nağd: *${money(drawer.expectedCashMinor ?? c.expectedCashMinor)}*`,
    );
  }

  if (t.openTableCount) {
    lines.push('', `⚠️ Açıq masa: ${t.openTableCount} (${money(t.openTablesTotalMinor)})`);
  }

  if (input.live) {
    lines.push(
      '',
      '_Bu rəqəmlər serverdəki nüsxədən alındı — kassada çek çap olunmayıb._',
      '_Kassa oflayndırsa, nüsxə son bağlantı anındakı vəziyyəti göstərir._',
    );
  }

  return lines.filter((l) => l !== null).join('\n');
}

export function lastReports(rows: ReportLiveRow[]): string {
  if (rows.length === 0) return '📄 Hələ hesabat çıxarılmayıb.';
  return rows
    .map((r) => {
      const totals = parseJson<ReportTotals>(r.totals_json);
      const canonical = parseJson<ReportCanonical>(r.canonical_json);
      return report({
        kind: r.kind === 'z' ? 'z' : 'x',
        sequenceNo: r.sequence_no,
        totals,
        canonical,
      });
    })
    .join('\n\n────────\n\n');
}

export function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}
