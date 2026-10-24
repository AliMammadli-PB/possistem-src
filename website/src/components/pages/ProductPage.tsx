import { Suspense } from 'react';
import { ProductPageContent } from '@/components/pages/ProductPageContent';

export function ProductPage() {
  return (
    <Suspense fallback={null}>
      <ProductPageContent />
    </Suspense>
  );
}
