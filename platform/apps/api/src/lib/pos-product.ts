import { sql } from 'drizzle-orm';
import { licenses } from '@milioner/database';

export type PosProduct = 'restaurant' | 'market';

export function isPosProduct(value: unknown): value is PosProduct {
  return value === 'restaurant' || value === 'market';
}

/**
 * Which POS a license is for is recorded in three places, written at different
 * points in the product's history:
 *
 *   activation_keys.product   most specific, added in migration 0022
 *   licenses.features->>'product'  set by createSale()
 *   licenses.plan             'market' for Market POS, 'standard' otherwise
 *
 * Resolve them in that order so licenses issued before 0022 still classify
 * correctly. Callers that have an activation key in scope should coalesce it
 * ahead of `licensePosProductSql`.
 *
 * Yields NULL when there is no license to classify — a customer who was created
 * but never sold anything belongs to neither product, and must not be swept up
 * by a "restaurant" filter.
 */
export const licensePosProductSql = sql<PosProduct | null>`
  case
    when ${licenses.id} is null then null
    when nullif(${licenses.features} ->> 'product', '') is not null
      then ${licenses.features} ->> 'product'
    when ${licenses.plan} = 'market' then 'market'
    else 'restaurant'
  end`;

/** Same classification for a license row already loaded into JS. */
export function licensePosProduct(license: {
  plan: string;
  features?: Record<string, unknown> | null;
}): PosProduct {
  const fromFeatures = license.features?.product;
  if (isPosProduct(fromFeatures)) return fromFeatures;
  return license.plan === 'market' ? 'market' : 'restaurant';
}

// Public product identity is distinct from the shared Market execution surface.
export type OwnerPosProduct = PosProduct | 'geyim' | 'aptek' | 'topdan';
export function isOwnerPosProduct(value: unknown): value is OwnerPosProduct {
 return ['restaurant','market','geyim','aptek','topdan'].includes(String(value));
}
export function licenseOwnerProduct(license:{plan:string;features?:Record<string,unknown>|null},keyProduct?:unknown):OwnerPosProduct {
 if(isOwnerPosProduct(keyProduct))return keyProduct;
 if(isOwnerPosProduct(license.features?.vertical))return license.features!.vertical as OwnerPosProduct;
 return licensePosProduct(license);
}
export const licenseOwnerProductSql=sql<OwnerPosProduct>`coalesce(
 (SELECT k.product FROM activation_keys k WHERE k.license_id=${licenses.id} AND k.revoked_at IS NULL ORDER BY k.created_at DESC,k.id LIMIT 1),
 nullif(${licenses.features}->>'vertical',''),nullif(${licenses.features}->>'product',''),
 CASE WHEN ${licenses.plan}='market' THEN 'market' ELSE 'restaurant' END)`;
