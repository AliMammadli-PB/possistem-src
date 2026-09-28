import { PHARMA_CATEGORIES } from './pharmacy';
import type { Lang } from './types';

/** Catalogue sections of the sale and stock screens: the pharmacy shelf groups. */
export type CatalogAisle = {
  id: string;
  order: number;
  labels: Record<Lang, string>;
};

export const CATALOG_AISLES: CatalogAisle[] = PHARMA_CATEGORIES.map(({ id, order, labels }) => ({ id, order, labels }));

const aisleById = new Map(CATALOG_AISLES.map((aisle) => [aisle.id, aisle]));

export function aisleLabel(id: string, lang: Lang): string {
  return aisleById.get(id)?.labels[lang] ?? id;
}

export function aisleSortKey(id: string): number {
  return aisleById.get(id)?.order ?? 800;
}

export function sortAisleIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => aisleSortKey(a) - aisleSortKey(b) || a.localeCompare(b, 'az'));
}

export const PRODUCT_FORM_AISLES = CATALOG_AISLES.map((aisle) => aisle.id);
