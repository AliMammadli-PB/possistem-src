import type { Lang } from './types';

/** AZN amount from qəpik, in the UI language's number format. */
export const money = (minor: number, lang: Lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', { style: 'currency', currency: 'AZN', minimumFractionDigits: 2 }).format(minor / 100);
/** Short, sortable local id: prefix, time, random suffix. */
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
