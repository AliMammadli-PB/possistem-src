import { localeForLanguage, type Language } from './i18n';

function formatAmount(amount: number, language: Language): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(localeForLanguage(language), {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatManat(amount: number, language: Language = 'az'): string {
  return `${formatAmount(amount, language)} ₼`;
}

export function formatManatWords(amount: number, language: Language = 'az'): string {
  const n = formatAmount(amount, language);
  return language === 'az' ? `${n} manat` : `${n} AZN`;
}
