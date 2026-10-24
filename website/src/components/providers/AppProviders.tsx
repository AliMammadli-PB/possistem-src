'use client';

import type { ReactNode } from 'react';
import { I18nProvider } from './I18nProvider';
import { AdminSessionProvider } from './AdminSessionProvider';
import { CustomerSessionProvider } from './CustomerSessionProvider';
import { ThemeProvider } from './ThemeProvider';
import { CartProvider } from './CartProvider';
import { PartnerProvider } from './PartnerProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <PartnerProvider><CartProvider>
          <AdminSessionProvider>
            <CustomerSessionProvider>{children}</CustomerSessionProvider>
          </AdminSessionProvider>
        </CartProvider></PartnerProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
