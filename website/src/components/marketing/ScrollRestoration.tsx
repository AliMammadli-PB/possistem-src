'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { scrollToSection } from '@/lib/scroll';

export function ScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);

    if (hash) {
      requestAnimationFrame(() => {
        if (!scrollToSection(hash, 'auto')) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
      });
      return;
    }

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
