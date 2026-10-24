'use client';

import { useI18n } from '@/components/providers/I18nProvider';

type TProps = {
  k: string;
  html?: boolean;
  className?: string;
};

export function T({ k, html = false, className }: TProps) {
  const { t } = useI18n();
  const text = t(k);

  if (html) {
    return <span className={className} dangerouslySetInnerHTML={{ __html: text }} />;
  }

  return <span className={className}>{text}</span>;
}
