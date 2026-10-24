'use client';

import Link from 'next/link';
import { useCart } from '@/components/providers/CartProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import type { CatalogProduct } from '@/lib/catalog-products';
import { productDetailPath, stockRemaining } from '@/lib/catalog-products';
import { formatManat } from '@/lib/money';
import {usePartner} from '@/components/providers/PartnerProvider';
import {partnerProductPrice,partnerPriceLabel} from '@/lib/partner-pricing';
import { whatsappProductQuoteUrl } from '@/lib/whatsapp';

export function HardwareCard({ product }: { product: CatalogProduct }) {
  const { t, language } = useI18n();
  const { add } = useCart();
  const href = productDetailPath(product);
  const qty = stockRemaining(product);
  const {partner,prices}=usePartner();
  const price=partnerProductPrice(product.id,product.price,prices);
  const special=Boolean(partner&&Object.hasOwn(prices,product.id));
  const priced=typeof price==='number'&&price>0;
  const available = qty > 0 || product.inStock !== false;

  return (
    <article className="hardware-card">
      <Link href={href} className="hardware-card-media hardware-card-media-link catalog-thumb">
        {product.image ? (
          <img
            className="hardware-card-image"
            src={product.image}
            alt={product.name}
            width={640}
            height={480}
            loading="lazy"
          />
        ) : (
          <div className="hardware-card-placeholder" aria-hidden="true" />
        )}
      </Link>
      <div className="hardware-card-body">
        {product.isTest&&<p className="hardware-card-meta"><strong>Şəxsi sınaq · real pul tutulmur</strong></p>}
        {product.category ? <p className="hardware-card-meta">{product.category}</p> : null}
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        {priced ? (
          <p className="hardware-card-price">{special?<span className="partner-price-badge">{partnerPriceLabel(language)}</span>:null}{formatManat(price!, language)}</p>
        ) : (
          <p className="hardware-card-price hardware-card-price--soon">{t('hardware.cta.quote')}</p>
        )}
        <div className="hardware-card-actions">
          {product.isTest?<Link href="/odenis/sinaq/" className="marketing-button primary">Test sifarişi yarat</Link>:priced ? (
            <button
              type="button"
              className="marketing-button primary"
              disabled={!available}
              onClick={() => add(product)}
            >
              {t('hardware.cta.order')}
            </button>
          ) : (
            <a
              className="marketing-button primary"
              href={whatsappProductQuoteUrl(language, product)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('hardware.cta.quote')}
            </a>
          )}
          <Link className="marketing-button secondary" href={href}>
            {t('hardware.cta.details')}
          </Link>
        </div>
      </div>
    </article>
  );
}
