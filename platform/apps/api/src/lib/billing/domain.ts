export class BillingError extends Error {
  constructor(public code: string, message: string, public httpStatus = 409) { super(message); }
}

export const MAX_MINOR = 100_000_000;
export function minor(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new BillingError('invalid_amount', 'Məbləğ düzgün deyil.', 400);
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new BillingError('invalid_amount', 'Məbləğ düzgün deyil.', 400);
  const [whole, fraction = ''] = text.split('.');
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_MINOR) throw new BillingError('invalid_amount', 'Məbləğ düzgün deyil.', 400);
  return n;
}
export function amount(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || minorUnits > MAX_MINOR) throw new BillingError('invalid_amount', 'Məbləğ düzgün deyil.', 400);
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, '0')}`;
}

// Azerbaijan's billing calendar uses UTC+04:00; preserve the original anchor
// so a Jan 31 renewal becomes Feb 28 and then Mar 31 rather than Mar 28.
export function localDay(date: Date): number { return new Date(date.getTime() + 4 * 3600_000).getUTCDate(); }
export function nextMonth(date: Date, anchorDay = localDay(date)): Date {
  const local = new Date(date.getTime() + 4 * 3600_000);
  const endDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 2, 0)).getUTCDate();
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, Math.min(anchorDay, endDay), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return new Date(next - 4 * 3600_000);
}

export function subscriptionState(enabled: boolean, paidUntil: string | Date | null, now = Date.now()): string {
  if (!enabled) return 'disabled';
  if (!paidUntil) return 'awaiting_payment';
  return new Date(paidUntil).getTime() > now ? 'active' : 'expired';
}
