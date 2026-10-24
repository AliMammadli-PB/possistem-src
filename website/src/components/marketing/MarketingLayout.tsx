import type { ReactNode } from 'react';
import './home-layout.css';
import { UiDiagnostics } from './UiDiagnostics';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { CartDrawer } from '@/components/marketing/CartDrawer';
import { SupportChatWidget } from '@/components/marketing/SupportChatWidget';
import { ScrollRestoration } from '@/components/marketing/ScrollRestoration';
import { SkipLink } from '@/components/marketing/SkipLink';

type MarketingLayoutProps = {
  children: ReactNode;
  compactHome?: boolean;
  solidHeader?: boolean;
  hideFooter?: boolean;
  hideWhatsApp?: boolean;
  currentNav?: 'information' | 'product' | 'pricing' | 'setup' | 'updates' | 'support' | 'chat';
};

export function MarketingLayout({
  children,
  compactHome = false,
  solidHeader,
  hideFooter,
  hideWhatsApp,
  currentNav,
}: MarketingLayoutProps) {
  return (
    <div className={`brand-site${compactHome ? ' ps-home-layout' : ''}`}>
      <SkipLink />
      <SiteHeader solid={solidHeader} currentNav={currentNav} />
      <main id="main">{children}</main>
      {hideFooter ? null : <SiteFooter compact={compactHome} />}
      {hideWhatsApp ? null : <SupportChatWidget />}
      <CartDrawer />
      <ScrollRestoration />
      <UiDiagnostics />
    </div>
  );
}
