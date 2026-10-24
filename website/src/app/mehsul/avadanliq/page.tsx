import type { Metadata } from 'next';
import { HardwarePage } from '@/components/pages/HardwarePage';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'POS avadanlıqları',
  description: t('hardware.meta.description', 'az'),
  alternates: { canonical: 'https://possistem.az/mehsul/avadanliq/' },
};

export default function Page() {
  return <HardwarePage />;
}
