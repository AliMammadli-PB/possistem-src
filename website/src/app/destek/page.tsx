import type { Metadata } from 'next';
import { SupportPage } from '@/components/pages/SupportPage';

export const metadata: Metadata = {
  title: 'Dəstək — possistem',
  description:
    'possistem dəstək: quraşdırma, bağlantı, lisenziya, yeniləmə və müştəri hesabı üzrə kömək.',
  alternates: { canonical: 'https://possistem.az/destek/' },
  openGraph: {
    title: 'Dəstək — possistem',
    description: 'Quraşdırma, bağlantı və hesab məsələlərində kömək.',
  },
};

export default function Page() {
  return <SupportPage />;
}
