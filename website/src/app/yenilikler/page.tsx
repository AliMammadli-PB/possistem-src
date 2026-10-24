import type { Metadata } from 'next';
import { UpdatesPage } from '@/components/pages/UpdatesPage';

export const metadata: Metadata = {
  title: 'Yeniliklər — possistem',
  description:
    'possistem son versiya, buraxılış tarixi, sistem tələbləri və Windows yükləmə.',
  alternates: { canonical: 'https://possistem.az/yenilikler/' },
  openGraph: {
    title: 'Yeniliklər — possistem',
    description: 'Son Windows quruluşu, ölçü və yeniləmə vəziyyəti.',
  },
};

export default function Page() {
  return <UpdatesPage />;
}
