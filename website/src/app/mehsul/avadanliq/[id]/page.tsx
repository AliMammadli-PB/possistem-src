import { HardwareDetailPageContent } from '@/components/pages/HardwareDetailPageContent';

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return {
    title: 'POS avadanlıq',
    alternates: {
      canonical: `https://possistem.az/mehsul/avadanliq/${encodeURIComponent(id)}/`,
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <HardwareDetailPageContent productId={decodeURIComponent(id)} />;
}
