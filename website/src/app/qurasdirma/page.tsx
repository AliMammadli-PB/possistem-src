import type { Metadata } from 'next';
import { SetupPage } from '@/components/pages/SetupPage';

export const metadata: Metadata = {
  title: 'Quraşdırma — possistem',
  description:
    'possistem quraşdırma: hesab, sistem tələbləri, Windows yükləmə, aktivasiya və server təsdiqi.',
  alternates: { canonical: 'https://possistem.az/qurasdirma/' },
  openGraph: {
    title: 'Quraşdırma — possistem',
    description:
      'Hesab yaradın, Windows quruluşunu yükləyin və POS bağlantısını təsdiqləyin.',
  },
};

export default function Page() {
  return <SetupPage />;
}
