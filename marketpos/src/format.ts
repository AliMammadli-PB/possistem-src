import type { Lang } from './types';

/** AZN amount from qəpik, in the UI language's number format. */
export const money = (minor: number, lang: Lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', { style: 'currency', currency: 'AZN', minimumFractionDigits: 2 }).format(minor / 100);
/** Short, sortable local id: prefix, time, random suffix. */
export const newId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

const AZ_WEEKDAYS = ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];
const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

/**
 * "şənbə, 26 sentyabr". Written out for Azerbaijani because browsers without
 * az locale data print "M09 26, Sat" from Intl.
 */
export const longDate = (date: Date, lang: Lang) =>
  lang === 'az'
    ? `${AZ_WEEKDAYS[date.getDay()]}, ${date.getDate()} ${AZ_MONTHS[date.getMonth()]}`
    : date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
