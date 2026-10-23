/**
 * What a partner (bayi) may sell, and what it costs them.
 *
 * One credit is one month of licence. A partner buys credits from POSSISTEM
 * and spends them on sales and renewals; the longest term they can give in one
 * go is a year, so a partner can never hand a customer years of service they
 * did not pay for. Only POSSISTEM (the admin) can issue other durations.
 */
export const RESELLER_TERMS = ['trial7', 1, 3, 6, 12] as const;
export type ResellerTerm = (typeof RESELLER_TERMS)[number];
export const RENEW_TERMS = [1, 3, 6, 12] as const;
export type RenewTerm = (typeof RENEW_TERMS)[number];

export const TRIAL_DAYS = 7;

/** Credits a term costs. A trial costs none; it is limited by count instead. */
export function creditCost(term: ResellerTerm): number {
  return term === 'trial7' ? 0 : term;
}

/** Calendar months, clamped to the last day of a shorter month (31 Jan + 1 = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** When a new sale on `term` ends. */
export function saleValidUntil(term: ResellerTerm, now: Date): Date {
  return term === 'trial7'
    ? new Date(now.getTime() + TRIAL_DAYS * 24 * 3600_000)
    : addMonths(now, term);
}

/**
 * When a renewal ends: from today if the licence has already lapsed (the
 * customer does not get the lapsed weeks back for free), otherwise from the
 * current end, so renewing early loses nothing.
 */
export function renewedUntil(current: Date | null, months: number, now: Date): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, months);
}

/** What the partner sees as the plan name. */
export function termLabel(term: ResellerTerm): string {
  return term === 'trial7' ? 'Sınaq 7 gün' : `${term} ay`;
}

/** A licence past its end is expired, whatever the stored status still says. */
export function effectiveStatus(status: string | null, validUntil: Date | null, now: Date): string | null {
  if (status === 'active' && validUntil && validUntil.getTime() < now.getTime()) return 'expired';
  return status;
}
