import type { Language } from './i18n';
import { formatManatWords } from './money';

export const WHATSAPP_PHONE = '994513333555';

const WHATSAPP_MESSAGES: Record<Language, string> = {
  az: 'Salam, possistem haqqında məlumat almaq istəyirəm.',
  en: 'Hello, I would like to get information about possistem.',
  ru: 'Здравствуйте, я хотел бы получить информацию о possistem.',
};

const WHATSAPP_SUPPORT_MESSAGES: Record<Language, string> = {
  az: 'Salam, possistem dəstəyinə ehtiyacım var.',
  en: 'Hello, I need support with possistem.',
  ru: 'Здравствуйте, мне нужна поддержка possistem.',
};

export function whatsappUrl(message: string): string {
  return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}

export function whatsappProductQuoteUrl(
  language: Language,
  product: { name: string; sku?: string },
): string {
  const name = product.name.trim();
  const sku = product.sku?.trim();
  const label = sku ? `${name} (${sku})` : name;
  const messages: Record<Language, string> = {
    az: `Salam, bu məhsul haqqında məlumat almaq istəyirəm: ${label}`,
    en: `Hello, I would like to get information about this product: ${label}`,
    ru: `Здравствуйте, я хотел бы получить информацию об этом товаре: ${label}`,
  };
  return whatsappUrl(messages[language]);
}

export function whatsappContactUrl(language: Language): string {
  return whatsappUrl(WHATSAPP_MESSAGES[language]);
}

export function whatsappSupportUrl(language: Language): string {
  return whatsappUrl(WHATSAPP_SUPPORT_MESSAGES[language]);
}

export function whatsappCartOrderUrl(
  language: Language,
  items: { name: string; sku?: string; qty: number; price: number }[],
  total: number,
): string {
  const lines = items.map((item, index) => {
    const label = item.sku?.trim() ? `${item.name.trim()} (${item.sku.trim()})` : item.name.trim();
    const lineTotal = item.price * item.qty;
    if (language === 'en') {
      return `${index + 1}. ${label} — ${item.qty} × ${formatManatWords(item.price, 'en')} = ${formatManatWords(lineTotal, 'en')}`;
    }
    if (language === 'ru') {
      return `${index + 1}. ${label} — ${item.qty} шт. × ${formatManatWords(item.price, 'ru')} = ${formatManatWords(lineTotal, 'ru')}`;
    }
    return `${index + 1}. ${label} — ${item.qty} ədəd × ${formatManatWords(item.price, 'az')} = ${formatManatWords(lineTotal, 'az')}`;
  });

  const messages: Record<Language, string> = {
    az: `Salam, bu məhsulları almaq istəyirəm:\n\n${lines.join('\n')}\n\nCəmi: ${formatManatWords(total, 'az')}`,
    en: `Hello, I would like to buy these products:\n\n${lines.join('\n')}\n\nTotal: ${formatManatWords(total, 'en')}`,
    ru: `Здравствуйте, я хотел бы купить эти товары:\n\n${lines.join('\n')}\n\nИтого: ${formatManatWords(total, 'ru')}`,
  };
  return whatsappUrl(messages[language]);
}

const WHATSAPP_TEST_MESSAGES: Record<Language, string> = {
  az: 'Salam, possistem test mesajıdır — inteqrasiya işləyir.',
  en: 'Hello, this is a possistem test message — integration works.',
  ru: 'Здравствуйте, это тестовое сообщение possistem — интеграция работает.',
};

export function whatsappTestUrl(language: Language): string {
  return whatsappUrl(WHATSAPP_TEST_MESSAGES[language]);
}
