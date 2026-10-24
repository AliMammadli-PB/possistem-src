'use client';

import Link from 'next/link';
import { useI18n } from '@/components/providers/I18nProvider';

export type ProductTab = 'program' | 'hardware';

type ProductTabsProps = {
  active: ProductTab;
};

export function ProductTabs({ active }: ProductTabsProps) {
  const { t } = useI18n();

  const tabs: { id: ProductTab; href: string; labelKey: string }[] = [
    { id: 'hardware', href: '/mehsul/avadanliq/', labelKey: 'product.tabs.hardware' },
    { id: 'program', href: '/mehsul/proqram/', labelKey: 'product.tabs.program' },
  ];

  return (
    <div className="product-tabs" role="tablist" aria-label={t('product.tabs.label')}>
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          role="tab"
          id={`product-tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-current={active === tab.id ? 'page' : undefined}
          className={active === tab.id ? 'is-active' : undefined}
        >
          {t(tab.labelKey)}
        </Link>
      ))}
    </div>
  );
}
