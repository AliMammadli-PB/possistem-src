export type PlanId = 'standart' | 'biznes' | 'premium';

/** Fallback monthly prices (minor units = qəpik) when admin API has 0 / empty. */
export const FALLBACK_MONTHLY_MINOR: Record<PlanId, number> = {
  standart: 4900, // 49 ₼
  biznes: 8900, // 89 ₼
  premium: 14900, // 149 ₼
};

export const PLAN_IDS: PlanId[] = ['standart', 'biznes', 'premium'];

export function resolveMonthlyMinor(
  id: PlanId,
  apiMinor: number | string | null | undefined,
): number {
  const n = Number(apiMinor);
  if (Number.isFinite(n) && n > 0) return n;
  return FALLBACK_MONTHLY_MINOR[id];
}

export function lowestMonthlyMinor(
  plans?: Partial<Record<PlanId, { monthlyPriceMinor?: number | string | null }>>,
): number {
  return Math.min(...PLAN_IDS.map((id) => resolveMonthlyMinor(id, plans?.[id]?.monthlyPriceMinor)));
}
