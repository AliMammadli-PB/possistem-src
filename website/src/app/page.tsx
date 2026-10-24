import type { Metadata } from 'next';
import { HomePage } from '@/components/pages/HomePage';
import { assetUrl } from '@/lib/assets';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t('meta.siteTitle', 'az'),
  description: t('meta.siteDescription', 'az'),
  alternates: { canonical: 'https://possistem.az/' },
  openGraph: {
    title: t('meta.siteTitle', 'az'),
    description: t('meta.ogDescription', 'az'),
    images: [assetUrl('/assets/hero-compare/pos-after.webp')],
  },
};

export default function Page() {
  return <HomePage />;
}
