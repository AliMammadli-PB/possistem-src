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
  const { items, total, open, setOpen, setQty, remove, clear, syncError,refresh } = useCart();
  const {partner}=usePartner();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if(event.key==='Tab'){const elements=Array.from(document.querySelectorAll<HTMLElement>('#site-cart a[href],#site-cart button:not([disabled]),#site-cart input:not([disabled])'));const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}

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
          <h2 id={titleId}>{t('cart.title')}<small>{items.reduce((n,i)=>n+i.qty,0)} məhsul</small>{partner?<small className="partner-price-badge">{partnerPriceLabel(language)}</small>:null}</h2>
          <button ref={closeRef} type="button" className="cart-close" onClick={() => setOpen(false)}>
            {t('cart.close')}
          </button>
        </header>

        {syncError&&<p className="cart-sync-error" role="status">{syncError}<button onClick={refresh}>Yenilə</button></p>}
        {items.length === 0 ? (
          <div className="cart-empty"><Cart/><h3>Səbətiniz boşdur</h3><p>Bəyəndiyiniz məhsulu əlavə edin; miqdarı və yekunu burada görəcəksiniz.</p><Link href="/mehsul/avadanliq/" onClick={()=>setOpen(false)}>Məhsullara bax →</Link></div>
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
                    <input aria-label={item.name+' miqdarı'} type="number" min={1} max={item.maxQty} step={1} value={item.qty} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1)setQty(item.id,n);}}/>
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
                <div className="cart-item-line">{formatManat(Math.round(item.price*100)*item.qty/100, language)}</div>
              </li>
            ))}
          </ul>
        )}

        <footer className="cart-foot">{items.length>0&&<button className="cart-clear" onClick={()=>{if(window.confirm('Səbət boşaldılsın?'))clear();}}>Səbəti boşalt</button>}
          <p className="cart-total">
            <span>{t('cart.total')}</span>
            <strong>{formatManat(total, language)}</strong>
          </p>
          <p className="cart-delivery-note">Çatdırılma və son məbləğ sifarişdə hesablanacaq. Kart məlumatları bank səhifəsində daxil edilir.</p>
          {items.length ? (
            <Link className="marketing-button primary cart-checkout" href="/odenis/" onClick={()=>setOpen(false)}>
              Ödənişə keç
            </Link>
          ) : (
            <button type="button" className="marketing-button primary cart-checkout" disabled>
              {t('cart.checkout')}
            </button>
          )}
          <div className="cart-secondary-links"><button onClick={()=>setOpen(false)}>Alışa davam et</button><a href="/pos/app/sifarisler">Sifarişlərim →</a></div>
        </footer>
      </aside>
    </div>
  );
}
