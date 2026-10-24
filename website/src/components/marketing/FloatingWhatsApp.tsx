'use client';

import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';
import { whatsappContactUrl } from '@/lib/whatsapp';

export function FloatingWhatsApp() {
  const { language, t } = useI18n();

  return (
    <a
      className="floating-support"
      href={whatsappContactUrl(language)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('index.attr.150')}
    >
      <img src={asset('/assets/icons/whatsapp.svg')} alt="" width={27} height={27} />
    </a>
  );
}
