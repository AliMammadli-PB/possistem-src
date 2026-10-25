'use client';

import Link from 'next/link';
import { useId } from 'react';
import { useCart } from '@/components/providers/CartProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import type { CatalogProduct } from '@/lib/catalog-products';
import { productDetailPath, stockRemaining } from '@/lib/catalog-products';
import { formatManat } from '@/lib/money';
import {usePartner} from '@/components/providers/PartnerProvider';
import {partnerProductPrice,partnerPriceLabel} from '@/lib/partner-pricing';

export function HardwareCard({ product }: { product: CatalogProduct }) {
  const { t, language } = useI18n();
  const { add } = useCart();
  const href = productDetailPath(product);
  const qty = stockRemaining(product);
  const {partner,prices}=usePartner();
  const price=partnerProductPrice(product.id,product.price,prices);
  const special=Boolean(partner&&Object.hasOwn(prices,product.id));
  const priced=typeof price==='number'&&price>0;
  const available = qty > 0 && product.inStock !== false;
  const availabilityId = useId();
  const unavailableReason = !priced
    ? (language==='ru'?'Пока не продаётся':language==='en'?'Not on sale yet':'Hələ satışda deyil')
    : !available
      ? (language==='ru'?'Нет в наличии':language==='en'?'Out of stock':'Stokda yoxdur')
      : undefined;

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
        {product.isTest&&<p className="hardware-card-meta"><strong>Şəxsi sınaq məhsulu</strong></p>}
        {product.category ? <p className="hardware-card-meta">{product.category}</p> : null}
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        {priced ? (
          <p className="hardware-card-price">{special?<span className="partner-price-badge">{partnerPriceLabel(language)}</span>:null}{formatManat(price!, language)}</p>
        ) : (
          <p id={availabilityId} className="hardware-card-price hardware-card-price--soon">{unavailableReason}</p>
        )}
        {priced && !available && <p id={availabilityId} className="hardware-card-meta">{unavailableReason}</p>}
        <div className="hardware-card-actions">
          {product.isTest?<Link href="/odenis/sinaq/" className="marketing-button primary">Test sifarişi yarat</Link>:(
            <button
              type="button"
              className="marketing-button primary"
              disabled={!priced || !available}
              aria-describedby={unavailableReason ? availabilityId : undefined}
              title={unavailableReason}
              onClick={() => add(product)}
            >
              {language==='ru'?'В корзину':language==='en'?'Add to cart':'Səbətə əlavə et'}
            </button>
          )}
          <Link className="marketing-button secondary" href={href}>
            {t('hardware.cta.details')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
