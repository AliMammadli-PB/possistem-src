import type { Lang } from './types';
export function settingsText(lang: Lang, az: string, ru: string, en: string) { return lang === 'ru' ? ru : lang === 'en' ? en : az; }
