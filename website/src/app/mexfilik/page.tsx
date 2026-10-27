import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/pages/PrivacyPage';

export const metadata: Metadata = {
  title: 'Məxfilik siyasəti — Possistem',
  description: 'Possistem xidmətlərində fərdi məlumatların toplanması, istifadəsi, saxlanması və hüquqlarınız.',
  alternates: { canonical: 'https://possistem.az/mexfilik/' },
  openGraph: {
    title: 'Məxfilik siyasəti — Possistem',
    description: 'Fərdi məlumatların necə işlənildiyi və qorunduğu barədə məlumat.',
    url: 'https://possistem.az/mexfilik/',
  },
};

export default function Page() {
  return <PrivacyPage />;
}
