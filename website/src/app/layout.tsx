import type { Metadata, Viewport } from 'next';
import { AppProviders } from '@/components/providers/AppProviders';
import { asset, assetUrl } from '@/lib/assets';
import { t } from '@/lib/i18n';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0c1628',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://possistem.az'),
  title: {
    default: t('meta.siteTitle', 'az'),
    template: '%s · possistem',
  },
  description: t('meta.siteDescription', 'az'),
  alternates: {
    canonical: 'https://possistem.az/',
  },
  openGraph: {
    type: 'website',
    url: 'https://possistem.az/',
    siteName: 'possistem',
    locale: 'az_AZ',
    title: t('meta.siteTitle', 'az'),
    description: t('meta.ogDescription', 'az'),
    images: [assetUrl('/assets/pos-demo/restoran-1.9.9-4k.png')],
  },
  icons: {
    icon: asset('/assets/brands/logo.png'),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="az" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t='dark';try{var s=localStorage.getItem('possistem-theme');if(s==='light'||s==='dark')t=s;}catch(e){}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==='dark'?'#0c1628':'#ffffff';})();` }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
