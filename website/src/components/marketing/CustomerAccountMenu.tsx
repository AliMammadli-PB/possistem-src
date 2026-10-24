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

export function CustomerAccountMenu() {
  const { t, language } = useI18n();
  const adminSession = useAdminSession();
  const customerSession = useCustomerSession();
  const [open, setOpen] = useState(false);
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
          <div className="header-account-menu" id={menuId} role="menu">
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
                <T k="nav.products" />
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
        <div className="header-account-menu" id={menuId} role="menu">
          <div className="header-account-menu-head">
            <div className="header-account-menu-head-row">
              {renderAvatar()}
              <div className="header-account-menu-head-copy">
                <strong>{displayName}</strong>
                {email ? <span>{email}</span> : null}
              </div>
            </div>
          </div>
          <div className="header-account-menu-list">
            <Link
              className="header-account-menu-item primary"
              href="/pos/app/"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <T k="liveChat.account.portal" />
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
              <T k="nav.products" />
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
              className="header-account-menu-item"
              role="menuitem"
              onClick={() => { setOpen(false); openSupportChat(); }}
            >
              {({ az: 'Canlı dəstək', en: 'Live support', ru: 'Онлайн-поддержка' } as Record<string, string>)[language] ?? 'Canlı dəstək'}
            </button>
            <button
              type="button"
              className="header-account-menu-item"
              role="menuitem"
              disabled={uploading}
              onClick={() => {
                avatarInputRef.current?.click();
              }}
            >
              <T k="liveChat.changeAvatar" />
            </button>
            <Link
              className="header-account-menu-item"
              href="/pos/app/settings/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <T k="liveChat.account.settings" />
            </Link>
            <button
              type="button"
              className="header-account-menu-item danger"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void customerSession.logout();
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
