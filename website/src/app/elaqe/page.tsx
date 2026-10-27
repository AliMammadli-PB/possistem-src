import type { Metadata } from 'next';
import { ContactPage } from '@/components/pages/ContactPage';

export const metadata: Metadata = {
  title: 'Əlaqə — Possistem',
  description: 'Possistem ilə telefon, e-poçt və müraciət forması vasitəsilə əlaqə saxlayın.',
  alternates: { canonical: 'https://possistem.az/elaqe/' },
  openGraph: {
    title: 'Əlaqə — Possistem',
    description: 'Satış, quraşdırma, məhsul seçimi və hesab məsələləri üçün Possistem ilə əlaqə.',
    url: 'https://possistem.az/elaqe/',
  },
};

export default function Page() {
  return <ContactPage />;
}
