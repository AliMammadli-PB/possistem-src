/**
 * Turns a free-text WhatsApp message into a command.
 *
 * People type from a phone keyboard: no Azerbaijani letters, random case,
 * "xhesabat" with no space, a stray "lütfen". So matching folds ə→e, ı→i, ş→s
 * and friends, strips punctuation, and accepts the shortest unambiguous prefix.
 */

export type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'tables' }
  | { kind: 'table'; needle: string; area?: string }
  | { kind: 'sales' }
  | { kind: 'summary' }
  | { kind: 'status' }
  | { kind: 'staff' }
  | { kind: 'top' }
  | { kind: 'product'; needle: string }
  | { kind: 'lastReport' }
  | { kind: 'history'; date: string }
  | { kind: 'xReport' }
  | { kind: 'zReport' }
  | { kind: 'price'; needle: string; priceMinor: number }
  | { kind: 'soldOut'; needle: string; soldOut: boolean }
  | { kind: 'confirm'; code: string }
  | { kind: 'cancel' }
  | { kind: 'unknown'; text: string };

/**
 * ə→e, ı→i, ş→s … so "MƏHSUL" and "mehsul" are the same word.
 *
 * The dotted capital İ is handled before `toLowerCase`, because JavaScript
 * lowercases it to "i" *plus a combining dot* — which then fails to match a
 * plain "i" and silently breaks every command typed in capitals.
 */
export function fold(raw: string): string {
  return raw
    .replace(/[əƏ]/g, 'e')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[’'`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Money as typed by a human: "3.50", "3,50", "3" → minor units. */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const major = Number(parts[0] || '0');
  if (!Number.isFinite(major) || major < 0) return null;
  const fracRaw = (parts[1] ?? '').slice(0, 2).padEnd(2, '0');
  const frac = Number(fracRaw);
  if (!Number.isFinite(frac)) return null;
  const minor = Math.round(major * 100 + frac);
  if (minor > 100_000_00) return null; // 100 000 AZN — a typo guard, not a limit
  return minor;
}

/** Business dates are `YYYY-MM-DD`; owners type `06.08.2026`, "dünən", "bugün". */
export function normalizeDate(raw: string, now = new Date()): string | null {
  const text = raw.trim();
  const day = (offset: number) => {
    const d = new Date(now.getTime() + offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  };
  if (/^(bugun|bu gun|today)$/.test(text)) return day(0);
  if (/^(dunen|dun|yesterday)$/.test(text)) return day(-1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dotted = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (dotted) {
    return `${dotted[3]}-${dotted[2]!.padStart(2, '0')}-${dotted[1]!.padStart(2, '0')}`;
  }
  return null;
}

const HELP = ['komek', 'komak', 'yardim', 'menu', 'help', 'emrler', 'komut', '?'];
const TABLES = ['masalar', 'masa siyahisi', 'stollar', 'acig masalar', 'aciq masalar'];
const SALES = ['satis', 'bugun', 'dovriyye', 'ciro', 'gunluk', 'gunluk satis'];
const SUMMARY = ['umumi', 'yekun', 'toplam', 'cemi', 'hamisi', 'total', 'ozet', 'xulase'];
const STATUS = ['status', 'durum', 'veziyyet', 'kassa'];
const STAFF = ['novbe', 'nobet', 'isciler', 'personal', 'kim var'];
const TOP = ['cox satilan', 'en cox satilan', 'top', 'top mehsul', 'populyar'];
const LAST_REPORT = ['son hesabat', 'sonuncu hesabat', 'axirinci hesabat'];
const CANCEL = ['legv', 'legv et', 'iptal', 'imtina', 'cancel', 'yox'];

function startsWithAny(text: string, list: string[]): boolean {
  return list.some((word) => text === word || text.startsWith(`${word} `));
}

function equalsAny(text: string, list: string[]): boolean {
  return list.includes(text);
}

/** Pulls "x"/"z" out of anything shaped like "x hesabat", "hesabat x", "xreport". */
function reportKind(text: string): 'x' | 'z' | null {
  const compact = text.replace(/\s+/g, '');
  if (/^(x|iks)(hesabat|report|rapor)$/.test(compact)) return 'x';
  if (/^(z|zed)(hesabat|report|rapor)$/.test(compact)) return 'z';
  if (/^(hesabat|report|rapor)(x|iks)$/.test(compact)) return 'x';
  if (/^(hesabat|report|rapor)(z|zed)$/.test(compact)) return 'z';
  if (compact === 'x' || compact === 'z') return compact as 'x' | 'z';
  return null;
}

export function parseCommand(raw: string): ParsedCommand {
  // Phones with a keyboard shortcut bar, and anyone used to Telegram, send
  // "/x" rather than "x" — the slash is punctuation, not part of the command.
  const text = fold(raw)
    .replace(/^[/!]+\s*/, '')
    .replace(/[!.]+$/g, '')
    .trim();
  if (!text) return { kind: 'unknown', text: raw };

  // A bare 4-digit number is an answer to a confirmation prompt, never a command.
  if (/^\d{4}$/.test(text)) return { kind: 'confirm', code: text };
  if (equalsAny(text, CANCEL)) return { kind: 'cancel' };

  const kind = reportKind(text);
  if (kind === 'x') return { kind: 'xReport' };
  if (kind === 'z') return { kind: 'zReport' };

  if (equalsAny(text, HELP) || startsWithAny(text, HELP)) return { kind: 'help' };
  if (startsWithAny(text, LAST_REPORT)) return { kind: 'lastReport' };
  if (startsWithAny(text, TOP)) return { kind: 'top' };
  if (startsWithAny(text, TABLES)) return { kind: 'tables' };
  if (startsWithAny(text, STAFF)) return { kind: 'staff' };
  // Before SALES: "ümumi satış" is the summary, not the sales breakdown.
  if (startsWithAny(text, SUMMARY)) return { kind: 'summary' };
  if (startsWithAny(text, SALES)) return { kind: 'sales' };
  if (startsWithAny(text, STATUS)) return { kind: 'status' };

  // masa 5 / masa 5 zal / stol 3 kabinet — number + optional hall/area
  const table = /^(?:masa|stol|table)\s+(.+)$/.exec(text);
  if (table) {
    const rest = table[1]!.trim();
    const numbered = /^(\d+)\s*(.*)$/.exec(rest);
    if (numbered) {
      const area = numbered[2]!.trim();
      return area
        ? { kind: 'table', needle: numbered[1]!, area }
        : { kind: 'table', needle: numbered[1]! };
    }
    // "masa zal 1" — hall first, then number
    const areaFirst = /^(.+?)\s+(\d+)$/.exec(rest);
    if (areaFirst) {
      return { kind: 'table', needle: areaFirst[2]!, area: areaFirst[1]!.trim() };
    }
    return { kind: 'table', needle: rest };
  }

  // qiymet <ad> <mebleg>  — the amount is always the last token
  const price = /^(?:qiymet|price|fiyat)\s+(.+)$/.exec(text);
  if (price) {
    const parts = price[1]!.trim().split(' ');
    const amount = parts.length > 1 ? parseMoney(parts[parts.length - 1]!) : null;
    if (amount != null) {
      return { kind: 'price', needle: parts.slice(0, -1).join(' '), priceMinor: amount };
    }
    // No amount: treat it as a lookup, which is what the owner meant.
    return { kind: 'product', needle: price[1]!.trim() };
  }

  const soldOut = /^(?:bitib|bitdi|yoxdur|stop)\s+(.+)$/.exec(text);
  if (soldOut) return { kind: 'soldOut', needle: soldOut[1]!.trim(), soldOut: true };

  const back = /^(?:var|geldi|acig|aciq|basla)\s+(.+)$/.exec(text);
  if (back) return { kind: 'soldOut', needle: back[1]!.trim(), soldOut: false };

  const product = /^(?:mehsul|urun|product|axtar)\s+(.+)$/.exec(text);
  if (product) return { kind: 'product', needle: product[1]!.trim() };

  // "hesabat 06.08.2026" — a dated lookup, after the x/z shapes above.
  const history = /^(?:hesabat|report|rapor)\s+(.+)$/.exec(text);
  if (history) {
    const date = normalizeDate(history[1]!.trim());
    if (date) return { kind: 'history', date };
  }

  return { kind: 'unknown', text: raw.trim() };
}
