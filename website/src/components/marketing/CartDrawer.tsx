'use client';

import { useEffect, useId, useRef } from 'react';
import { useCart } from '@/components/providers/CartProvider';
import {usePartner} from '@/components/providers/PartnerProvider';
import {partnerPriceLabel} from '@/lib/partner-pricing';
import { useI18n } from '@/components/providers/I18nProvider';
import { formatManat } from '@/lib/money';
import Link from 'next/link';
import { Cart } from './DesignIcons';

export function CartToggle() {
  const { t } = useI18n();
  const { count, open, setOpen } = useCart();

  return (
    <button
      type="button"
      className="cart-toggle"
      aria-label={t('cart.open')}
      aria-expanded={open}
      aria-controls="site-cart"
      onClick={() => setOpen(!open)}
    >
      <Cart />
      {count > 0 ? <span className="cart-badge">{count > 99 ? '99+' : count}</span> : null}
    </button>
  );
}

export function CartDrawer() {
  const { t, language } = useI18n();
  const { items, total, open, setOpen, setQty, remove } = useCart();
  const {partner}=usePartner();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('cart-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('cart-open');
      previous?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="cart-layer">
      <button type="button" className="cart-overlay" aria-label={t('cart.close')} onClick={() => setOpen(false)} />
      <aside id="site-cart" className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="cart-head">
          <h2 id={titleId}>{t('cart.title')}{partner?<small className="partner-price-badge">{partnerPriceLabel(language)}</small>:null}</h2>
          <button ref={closeRef} type="button" className="cart-close" onClick={() => setOpen(false)}>
            {t('cart.close')}
          </button>
        </header>

        {items.length === 0 ? (
          <p className="cart-empty">{t('cart.empty')}</p>
        ) : (
          <ul className="cart-list">
            {items.map((item) => (
              <li key={item.id} className="cart-item">
                <div className="cart-item-media catalog-thumb">
                  {item.image ? <img src={item.image} alt="" width={72} height={72} /> : null}
                </div>
                <div className="cart-item-copy">
                  <strong>{item.name}</strong>
                  <span>{formatManat(item.price, language)}</span>
                  <div className="cart-item-qty">
                    <button
                      type="button"
                      className="cart-step"
                      aria-label={t('cart.decrease')}
                      disabled={item.qty <= 1}
                      onClick={() => setQty(item.id, item.qty - 1)}
                    >
                      −
                    </button>
                    <span>{item.qty}</span>
                    <button
                      type="button"
                      className="cart-step"
                      aria-label={t('cart.increase')}
                      disabled={item.qty >= item.maxQty}
                      onClick={() => setQty(item.id, item.qty + 1)}
                    >
                      +
                    </button>
                    <button type="button" className="cart-remove" onClick={() => remove(item.id)}>
                      {t('cart.remove')}
                    </button>
                  </div>
                </div>
                <div className="cart-item-line">{formatManat(item.price * item.qty, language)}</div>
              </li>
            ))}
          </ul>
        )}

        <footer className="cart-foot">
          <p className="cart-total">
            <span>{t('cart.total')}</span>
            <strong>{formatManat(total, language)}</strong>
          </p>
          {items.length ? (
            <Link className="marketing-button primary cart-checkout" href="/odenis/" onClick={()=>setOpen(false)}>
              Ödənişə keç
            </Link>
          ) : (
            <button type="button" className="marketing-button primary cart-checkout" disabled>
              {t('cart.checkout')}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
