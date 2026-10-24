'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { T } from '@/components/marketing/T';
import { useI18n } from '@/components/providers/I18nProvider';
import { fetchPublicProduct, hasPublicPrice, stockRemaining, type CatalogProduct } from '@/lib/catalog-products';
import { catalogHref } from '@/lib/catalog-tree';
import { formatManat } from '@/lib/money';
import { whatsappProductQuoteUrl } from '@/lib/whatsapp';
import { useCart } from '@/components/providers/CartProvider';
import {usePartner} from '@/components/providers/PartnerProvider';
import {partnerProductPrice,partnerPriceLabel} from '@/lib/partner-pricing';

type HardwareDetailPageContentProps = {
  productId: string;
};

export function HardwareDetailPageContent({ productId }: HardwareDetailPageContentProps) {
  const { t, language } = useI18n();
  const { add } = useCart();
  const {partner,prices}=usePartner();
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPublicProduct(productId);
        if (cancelled) return;
        setProduct(data);
        setActiveImage(0);
      } catch {
        if (!cancelled) setError('missing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const images = product?.images?.length
    ? product.images
    : product?.image
      ? [product.image]
      : [];

  const specs = (product?.specs ?? []).filter(
    (s) =>
      s?.name &&
      s?.value &&
      !/price|qiymət|azn|₼/i.test(`${s.name} ${s.value}`) &&
      !/stock|stok|quantity|availability/i.test(`${s.group ?? ''} ${s.name}`),
  );
  const qty = product ? stockRemaining(product) : 0;
  const price=product?partnerProductPrice(product.id,product.price,prices):null;
  const special=Boolean(partner&&product&&Object.hasOwn(prices,product.id));
  const priced=typeof price==='number'&&price>0;
  const available = Boolean(product && (qty > 0 || product.inStock !== false));

  return (
    <MarketingLayout solidHeader currentNav="product">
      <section className="marketing-section hardware-detail-section">
        <div className="marketing-container">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/">
              <T k="product.text.019" />
            </Link>
            <span>/</span>
            <Link href={catalogHref()}>
              <T k="product.tabs.hardware" />
            </Link>
            {product?.parentCategorySlug ? (
              <>
                <span>/</span>
                <Link href={catalogHref({ parent: product.parentCategorySlug })}>
                  {product.parentCategory}
                </Link>
              </>
            ) : null}
            {product?.categorySlug ? (
              <>
                <span>/</span>
                <Link
                  href={catalogHref({
                    parent: product.parentCategorySlug,
                    category: product.categorySlug,
                  })}
                >
                  {product.category}
                </Link>
              </>
            ) : null}
            <span>/</span>
            <span>{product?.name ?? '…'}</span>
          </nav>

          {loading ? <p className="hardware-status">{t('hardware.loading')}</p> : null}
          {error ? (
            <div className="hardware-detail-empty">
              <p className="hardware-status hardware-status--error" role="alert">
                {t('hardware.detail.notFound')}
              </p>
              <Link className="marketing-button secondary" href="/mehsul/avadanliq/">
                <T k="hardware.detail.back" />
              </Link>
            </div>
          ) : null}

          {!loading && product ? (
            <div className="hardware-detail-grid">
              <div className="hardware-detail-gallery">
                <div className="hardware-detail-stage">
                  {images[activeImage] ? (
                    <img
                      src={images[activeImage]}
                      alt={product.name}
                      width={900}
                      height={700}
                    />
                  ) : (
                    <div className="hardware-card-placeholder" aria-hidden="true" />
                  )}
                </div>
                {images.length > 1 ? (
                  <ul className="hardware-detail-thumbs">
                    {images.map((src, index) => (
                      <li key={`${src}-${index}`}>
                        <button
                          type="button"
                          className={index === activeImage ? 'is-active' : undefined}
                          onClick={() => setActiveImage(index)}
                          aria-label={`${product.name} ${index + 1}`}
                        >
                          <img src={src} alt="" aria-hidden="true" loading="lazy" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="hardware-detail-copy">
                <span className="marketing-eyebrow">{product.category}</span>
                <h1>{product.name}</h1>
                {product.shortDescription ? <p className="hardware-detail-lead">{product.shortDescription}</p> : null}
                <dl className="hardware-detail-meta">
                  {product.brand ? (
                    <>
                      <dt>
                        <T k="hardware.detail.brand" />
                      </dt>
                      <dd>{product.brand}</dd>
                    </>
                  ) : null}
                  {product.sku ? (
                    <>
                      <dt>
                        <T k="hardware.detail.sku" />
                      </dt>
                      <dd>{product.sku}</dd>
                    </>
                  ) : null}
                  {priced ? (
                    <>
                      <dt>
                        {special?partnerPriceLabel(language):<T k="hardware.detail.price" />}
                      </dt>
                      <dd>{formatManat(price!, language)}</dd>
                    </>
                  ) : null}
                </dl>

                {product.description && product.description !== product.shortDescription ? (
                  <div className="hardware-detail-desc">
                    <h2>
                      <T k="hardware.detail.description" />
                    </h2>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{product.description}</p>
                  </div>
                ) : null}

                {specs.length > 0 ? (
                  <div className="hardware-detail-specs">
                    <h2>
                      <T k="hardware.detail.specs" />
                    </h2>
                    <table>
                      <tbody>
                        {specs.map((spec) => (
                          <tr key={`${spec.group ?? ''}-${spec.name}-${spec.value}`}>
                            <th scope="row">{spec.name}</th>
                            <td>{spec.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div className="hardware-detail-actions">
                  {priced ? (
                    <button
                      type="button"
                      className="marketing-button primary"
                      disabled={!available}
                      onClick={() => add(product)}
                    >
                      <T k="hardware.cta.order" />
                    </button>
                  ) : (
                    <a
                      className="marketing-button primary"
                      href={whatsappProductQuoteUrl(language, product)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <T k="hardware.cta.quote" />
                    </a>
                  )}
                  <Link className="marketing-button secondary" href="/mehsul/avadanliq/">
                    <T k="hardware.detail.back" />
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </MarketingLayout>
  );
}
