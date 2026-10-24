'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ProductTabsBar } from '@/components/marketing/ProductTabsBar';
import { T } from '@/components/marketing/T';
import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';

export function ProductPageContent() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get('view') === 'hardware') {
      router.replace('/mehsul/avadanliq/');
    }
  }, [router, searchParams]);

  return (
    <MarketingLayout solidHeader currentNav="product">
      <ProductTabsBar />

      <section className="page-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/">
                <T k="product.text.019" />
              </Link>
              <span>/</span>
              <span>
                <T k="product.text.020" />
              </span>
            </nav>
            <span className="marketing-eyebrow">
              <T k="product.text.021" />
            </span>
            <h1>
              <T k="product.hero.heading" html />
            </h1>
            <p>
              <T k="product.text.024" />
            </p>
            <div className="hero-actions">
              <Link className="marketing-button primary" href="/melumatlar/#elaqe">
                <T k="product.text.025" />
              </Link>
              <Link className="marketing-button secondary" href="/pos/app/login">
                <T k="product.text.026" />
              </Link>
            </div>
          </div>
          <img
            className="page-hero-illustration"
            src={asset('/assets/pos-demo/restoran-1.9.9-4k.png')}
            alt={t('image.product.hero')}
            width={3840}
            height={2160}
          />
        </div>
      </section>

      <section className="marketing-section" id="product-panel-program">
        <div className="marketing-container">
          <header className="marketing-heading reveal">
            <div>
              <span className="marketing-eyebrow">
                <T k="product.text.028" />
              </span>
              <h2>
                <T k="product.text.029" />
              </h2>
            </div>
            <p>
              <T k="product.text.030" />
            </p>
          </header>
          <div className="feature-detail-list">
            <article className="feature-detail reveal">
              <div className="feature-detail-copy">
                <span className="feature-number">
                  <T k="product.text.031" />
                </span>
                <h3>
                  <T k="product.text.032" />
                </h3>
                <p>
                  <T k="product.text.033" />
                </p>
                <ul>
                  {['product.text.034', 'product.text.035', 'product.text.036', 'product.text.037'].map((key) => (
                    <li key={key}>
                      <T k={key} />
                    </li>
                  ))}
                </ul>
              </div>
              <img
                src={asset('/assets/pos-demo/market-1.5.47-4k.png')}
                alt={t('image.product.cashier')}
                width={3840}
                height={2160}
                loading="lazy"
              />
            </article>
            <article className="feature-detail reverse reveal">
              <div className="feature-detail-copy">
                <span className="feature-number">
                  <T k="product.text.039" />
                </span>
                <h3>
                  <T k="product.text.040" />
                </h3>
                <p>
                  <T k="product.text.041" />
                </p>
                <ul>
                  {['product.text.042', 'product.text.043', 'product.text.044', 'product.text.045'].map((key) => (
                    <li key={key}>
                      <T k={key} />
                    </li>
                  ))}
                </ul>
              </div>
              <img
                src={asset('/assets/editorial/v2-product-owner.png')}
                alt={t('image.product.owner')}
                width={1440}
                height={900}
                loading="lazy"
              />
            </article>
            <article className="feature-detail reveal">
              <div className="feature-detail-copy">
                <span className="feature-number">
                  <T k="product.text.047" />
                </span>
                <h3>
                  <T k="product.text.048" />
                </h3>
                <p>
                  <T k="product.text.049" />
                </p>
                <ul>
                  {['product.text.050', 'product.text.051', 'product.text.052', 'product.text.053'].map((key) => (
                    <li key={key}>
                      <T k={key} />
                    </li>
                  ))}
                </ul>
              </div>
              <img
                src={asset('/assets/editorial/v2-product-notifications.png')}
                alt={t('image.product.notifications')}
                width={1440}
                height={900}
                loading="lazy"
              />
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section product-capabilities">
        <div className="marketing-container">
          <header className="marketing-heading centered reveal">
            <div>
              <span className="marketing-eyebrow">
                <T k="product.text.055" />
              </span>
              <h2>
                <T k="product.text.056" />
              </h2>
            </div>
            <p>
              <T k="product.text.057" />
            </p>
          </header>
          <div className="capability-grid">
            {[
              ['01', 'product.text.058', 'product.text.059'],
              ['02', 'product.text.060', 'product.text.061'],
              ['03', 'product.text.062', 'product.text.063'],
              ['04', 'product.text.064', 'product.text.065'],
              ['05', 'product.text.066', 'product.text.067'],
              ['06', 'product.text.068', 'product.text.069'],
            ].map(([num, title, body]) => (
              <article key={num}>
                <span className="premium-symbol" aria-hidden="true">
                  {num}
                </span>
                <h3>
                  <T k={title} />
                </h3>
                <p>
                  <T k={body} />
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-cta">
        <div className="marketing-container cta-inner">
          <div>
            <span className="marketing-eyebrow">
              <T k="product.text.070" />
            </span>
            <h2>
              <T k="product.text.071" />
            </h2>
            <p>
              <T k="product.text.072" />
            </p>
          </div>
          <div>
            <Link className="marketing-button primary" href="/melumatlar/#elaqe">
              <T k="product.text.073" />
            </Link>
            <Link className="marketing-button secondary" href="/mehsul/avadanliq/">
              <T k="product.tabs.hardware" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
