'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { HardwareCatalog } from '@/components/marketing/HardwareCatalog';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { useI18n } from '@/components/providers/I18nProvider';

export function HardwarePageContent() {
  const { t,language } = useI18n();
  const help=language==='az'?{title:'Seçimdə kömək lazımdır?',body:'Biznesinizə uyğun avadanlığı birlikdə seçək.',support:'Dəstək alın',setup:'Quraşdırma'}:language==='ru'?{title:'Нужна помощь с выбором?',body:'Подберём оборудование для вашего бизнеса.',support:'Поддержка',setup:'Установка'}:{title:'Need help choosing?',body:'Let’s find equipment that fits your business.',support:'Get support',setup:'Installation'};
  return (
    <MarketingLayout solidHeader currentNav="product">
      <section className="marketing-section hardware-section" id="product-panel-hardware">
        <div className="marketing-container">
          <Suspense fallback={<p className="hardware-status">{t('hardware.loading')}</p>}>
            <HardwareCatalog />
          </Suspense>
        </div>
      </section>

      <aside className="store-help marketing-container" aria-label={help.title}>
        <div><h2>{help.title}</h2><p>{help.body}</p></div>
        <div><Link href="/destek/">{help.support}<span aria-hidden="true">↗</span></Link><Link href="/qurasdirma/">{help.setup}<span aria-hidden="true">→</span></Link></div>
      </aside>
    </MarketingLayout>
  );
}
