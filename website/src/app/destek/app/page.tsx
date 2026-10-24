import type { Metadata } from 'next';
import { SupportAppPage } from '@/components/pages/SupportAppPage';

export const metadata: Metadata = {
  title: 'Dəstək tətbiqi — possistem',
  description: 'possistem dəstək komandası üçün Android tətbiqi: müştəri yazanda telefon zəng kimi çalır.',
  alternates: { canonical: 'https://possistem.az/destek/app/' },
  // A staff tool: reachable by link, kept out of search results.
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SupportAppPage />;
}
