'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { HardwareCatalog } from '@/components/marketing/HardwareCatalog';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { T } from '@/components/marketing/T';
import { useI18n } from '@/components/providers/I18nProvider';

export function HardwarePageContent() {
  const { t } = useI18n();
  return (
    <MarketingLayout solidHeader currentNav="product">
      <section className="marketing-section hardware-section" id="product-panel-hardware">
        <div className="marketing-container">
          <Suspense fallback={<p className="hardware-status">{t('hardware.loading')}</p>}>
            <HardwareCatalog />
          </Suspense>
        </div>
      </section>

      <section className="marketing-cta">
        <div className="marketing-container cta-inner">
          <div>
            <span className="marketing-eyebrow">
              <T k="hardware.ctaBlock.eyebrow" />
            </span>
            <h2>
              <T k="hardware.ctaBlock.title" />
            </h2>
            <p>
              <T k="hardware.ctaBlock.desc" />
            </p>
          </div>
          <div>
            <Link className="marketing-button primary" href="/pos/app/sifarisler">
              Sifarişlərim
            </Link>
            <Link className="marketing-button secondary" href="/qurasdirma/">
              <T k="product.text.074" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
