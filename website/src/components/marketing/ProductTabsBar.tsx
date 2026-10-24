'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/components/providers/I18nProvider';

export type ProductTab = 'program' | 'hardware';

export function ProductTabsBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const active: ProductTab = pathname.startsWith('/mehsul/proqram') ? 'program' : 'hardware';

  const tabs: { id: ProductTab; href: string; labelKey: string }[] = [
    { id: 'hardware', href: '/mehsul/avadanliq/', labelKey: 'product.tabs.hardware' },
    { id: 'program', href: '/mehsul/proqram/', labelKey: 'product.tabs.program' },
  ];

  return (
    <div className="product-tabs-bar" id="product-tabs">
      <div className="marketing-container product-tabs-wrap">
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
      </div>
    </div>
  );
}
