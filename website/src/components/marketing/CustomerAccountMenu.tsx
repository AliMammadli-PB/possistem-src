'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useAdminSession } from '@/components/providers/AdminSessionProvider';
import { useCustomerSession } from '@/components/providers/CustomerSessionProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { ADMIN_CONSOLE_PATH } from '@/lib/admin-session';
import { customerLoginUrl } from '@/lib/customer-auth-url';
import { uploadAvatar } from '@/lib/public-chat-api';
import { T } from './T';
import { openSupportChat } from './SupportChatWidget';

function initialsFrom(label: string): string {
  const cleaned = label.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s._@-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase().slice(0, 2);
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`header-account-chevron${open ? ' is-open' : ''}`}
      viewBox="0 0 12 12"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M2.2 4.2a.75.75 0 0 1 1.06 0L6 6.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L2.2 5.26a.75.75 0 0 1 0-1.06Z"
      />
    </svg>
  );
}

function AccountIcon({name}:{name:string}){
 const paths:Record<string,string>={portal:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',card:'M3 5h18v14H3z M3 9h18 M7 15h3',bag:'M5 7h14l1 14H4L5 7 M8 7V5a4 4 0 0 1 8 0v2',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',store:'M3 10h18l-2-6H5l-2 6 M5 10v10h14V10 M9 20v-6h6v6',chat:'M4 4h16v12H9l-5 4V4 M8 8h8 M8 12h5',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',avatar:'M4 4h16v16H4z M8 10a4 4 0 0 1 8 0 M7 17c2-4 8-4 10 0',settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',logout:'M10 4H4v16h6 M8 12h13 M17 8l4 4-4 4'};
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.portal}/></svg>;
}

export function CustomerAccountMenu() {
  const { t, language } = useI18n();
  const adminSession = useAdminSession();
  const customerSession = useCustomerSession();
  const [open, setOpen] = useState(false);
  const [menuOffset, setMenuOffset] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [entered, setEntered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (anchor) setMenuOffset(Math.max(0, 12 - (anchor.right - Math.min(320, window.innerWidth - 24))));
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open]);

  const loading = adminSession.loading || customerSession.loading;

  if (loading) {
    return <span className="header-account-skeleton" aria-hidden="true" />;
  }

  if (adminSession.authenticated) {
    const email = adminSession.email ?? t('liveChat.account.adminFallback');
    const displayName = email.split('@')[0] || email;

    return (
      <div
        className={`header-account${entered ? ' is-ready' : ''}${open ? ' is-open' : ''}`}
        ref={rootRef}
      >
        <button
          type="button"
          className="header-account-trigger header-account-trigger-admin"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-label={`${displayName} — ${email} — ${t('liveChat.account.adminBadge')}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="header-account-avatar header-account-avatar-admin" aria-hidden="true">
            {initialsFrom(displayName)}
          </span>
          <span className="header-account-copy">
            <strong>{displayName}</strong>
          </span>
          <Chevron open={open} />
        </button>

        {open ? (
          <div className="header-account-menu" style={{right:-menuOffset}} id={menuId} role="menu">
            <div className="header-account-menu-head">
              <div className="header-account-menu-head-row">
                <span className="header-account-avatar header-account-avatar-admin" aria-hidden="true">
                  {initialsFrom(displayName)}
                </span>
                <div className="header-account-menu-head-copy">
                  <strong>{displayName}</strong>
                  <span>{email}</span>
                  <span className="header-account-admin-badge">
                    <T k="liveChat.account.adminBadge" />
                  </span>
                </div>
              </div>
            </div>
            <div className="header-account-menu-list">
              <Link
                className="header-account-menu-item primary"
                href={ADMIN_CONSOLE_PATH}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <T k="liveChat.account.adminPanel" />
              </Link>
              <p className="header-account-menu-label">
                <T k="account.quickLinks" />
              </p>
              <Link
                className="header-account-menu-item"
                href="/mehsul/avadanliq/"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {{az:'Mağaza',en:'Store',ru:'Магазин'}[language]}
              </Link>
              <Link
                className="header-account-menu-item"
                href="/qurasdirma/"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <T k="index.text.012" />
              </Link>
              <Link
                className="header-account-menu-item"
                href="/yenilikler/"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <T k="index.text.013" />
              </Link>
              <button
                type="button"
                className="header-account-menu-item danger"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void adminSession.logout();
                }}
              >
                <T k="liveChat.account.logout" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!customerSession.authenticated) {
    return (
      <Link className={`header-account-login${entered ? ' is-ready' : ''}`} href={customerLoginUrl('/')} aria-label={t('index.text.015')} title={t('index.text.015')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><span className="ps-account-label"><T k="index.text.015" /></span>
      </Link>
    );
  }

  const displayName =
    customerSession.name || customerSession.email || t('liveChat.account.fallback');
  const email =
    customerSession.email && customerSession.email !== displayName ? customerSession.email : null;

  const onAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(file, customerSession.csrfToken);
      customerSession.setAvatarUrl(url);
    } catch {
      /* keep current avatar */
    } finally {
      setUploading(false);
    }
  };

  const renderAvatar = () => (
    <span className={`header-account-avatar${uploading ? ' is-busy' : ''}`} aria-hidden="true">
      {customerSession.avatarUrl ? (
        <img src={customerSession.avatarUrl} alt="" />
      ) : (
        initialsFrom(displayName)
      )}
    </span>
  );

  return (
    <div
      className={`header-account${entered ? ' is-ready' : ''}${open ? ' is-open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="header-account-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={email ? `${displayName} · ${email}` : displayName}
        onClick={() => setOpen((value) => !value)}
      >
        {renderAvatar()}
        <span className="header-account-copy">
          <strong>{displayName}</strong>
        </span>
        <Chevron open={open} />
      </button>

      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={onAvatarFile}
      />

      {open ? (
        <div className="header-account-menu customer-menu" style={{right:-menuOffset}} id={menuId} role="menu" onKeyDown={event=>{
          const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
          const index=items.indexOf(document.activeElement as HTMLElement);
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
          if(event.key==='Home'||event.key==='End'){event.preventDefault();items[event.key==='Home'?0:items.length-1]?.focus();}
          if(event.key==='Escape'){setOpen(false);rootRef.current?.querySelector<HTMLButtonElement>('.header-account-trigger')?.focus();}
        }}>
          <div className="header-account-menu-head"><div className="header-account-menu-head-row">{renderAvatar()}<div className="header-account-menu-head-copy"><strong>{displayName}</strong>{email&&<span>{email}</span>}<small>{{az:'Müştəri hesabı',en:'Customer account',ru:'Аккаунт клиента'}[language]}</small></div></div></div>
          <div className="header-account-menu-list">
            <Link className="header-account-menu-item primary" href="/pos/app/" role="menuitem" onClick={()=>setOpen(false)}><AccountIcon name="portal"/><span><strong>{{az:'Müştəri paneli',en:'Customer portal',ru:'Личный кабинет'}[language]}</strong><small>{{az:'Biznesinizə ümumi baxış',en:'Your business overview',ru:'Обзор вашего бизнеса'}[language]}</small></span><span className="account-menu-arrow" aria-hidden="true">↗</span></Link>
            <p className="header-account-menu-label">{{az:'Hesab və alışlar',en:'Account and purchases',ru:'Аккаунт и покупки'}[language]}</p>
            {[
              {href:'/pos/app/abunelik',icon:'card',az:'POS abunəliklərim',en:'POS subscriptions',ru:'Подписки POS'},
              {href:'/pos/app/sifarisler',icon:'bag',az:'Sifarişlərim',en:'My orders',ru:'Мои заказы'},
              {href:'/pos/app/activity',icon:'bell',az:'Bildirişlər və fakturalar',en:'Notifications and invoices',ru:'Уведомления и счета'},
              {href:'/mehsul/avadanliq/',icon:'store',az:'Mağaza',en:'Store',ru:'Магазин'},
            ].map(item=><Link key={item.href} className="header-account-menu-item" href={item.href} role="menuitem" onClick={()=>setOpen(false)}><AccountIcon name={item.icon}/>{item[language]}</Link>)}
            <p className="header-account-menu-label">{{az:'Kömək və parametrlər',en:'Help and settings',ru:'Помощь и настройки'}[language]}</p>
            <button type="button" className="header-account-menu-item" role="menuitem" onClick={()=>{setOpen(false);openSupportChat();}}><AccountIcon name="chat"/>{{az:'Canlı dəstək',en:'Live support',ru:'Онлайн-поддержка'}[language]}</button>
            <Link className="header-account-menu-item" href="/qurasdirma/" role="menuitem" onClick={()=>setOpen(false)}><AccountIcon name="download"/>{{az:'Quraşdırma və yükləmələr',en:'Installation and downloads',ru:'Установка и загрузки'}[language]}</Link>
            <button type="button" className="header-account-menu-item" role="menuitem" disabled={uploading} onClick={()=>avatarInputRef.current?.click()}><AccountIcon name="avatar"/><T k="liveChat.changeAvatar"/></button>
            <Link className="header-account-menu-item" href="/pos/app/settings/profile" role="menuitem" onClick={()=>setOpen(false)}><AccountIcon name="settings"/><T k="liveChat.account.settings"/></Link>
            <button type="button" className="header-account-menu-item danger" role="menuitem" onClick={()=>{setOpen(false);void customerSession.logout();}}><AccountIcon name="logout"/><T k="liveChat.account.logout"/></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
