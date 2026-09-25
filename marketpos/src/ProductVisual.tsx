import { useEffect, useRef, useState } from 'react';

import type { Product } from './types';

export function normalizeProductImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('market-pos://') || url.startsWith('https://') || url.startsWith('http://')) return url;
  if (url.startsWith('/assets/')) return `market-pos://app${url}`;
  if (url.startsWith('./assets/')) return `market-pos://app/${url.slice(2)}`;
  if (url.startsWith('assets/')) return `market-pos://app/${url}`;
  return url;
}

type ProductVisualProps = {
  image: Product['image'];
  compact?: boolean;
  alt?: string;
  accent?: string;
  /** Wait until near viewport before setting img src (catalog grids). */
  defer?: boolean;
};

export function ProductVisual({
  image,
  compact = false,
  alt = 'Məhsul',
  accent = '#0a4f9c',
  defer = false,
}: ProductVisualProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [broken, setBroken] = useState(false);
  const [visible, setVisible] = useState(!defer || compact);
  const url = image.kind === 'url' ? normalizeProductImageUrl(image.url) : '';

  useEffect(() => {
    setBroken(false);
  }, [url]);

  useEffect(() => {
    if (!defer || compact || visible || !url) return;
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px 0px', threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [defer, compact, visible, url]);

  const className = compact ? 'product-visual compact' : 'product-visual';
  if (url && visible && !broken) {
    return (
      <span ref={hostRef} className={className}>
        <img
          src={url}
          alt={alt}
          loading={compact ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={compact ? 'high' : 'low'}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      </span>
    );
  }

  const letter = alt.trim().slice(0, 1).toLocaleUpperCase('az') || 'M';
  return (
    <span
      ref={hostRef}
      className={compact ? 'product-visual placeholder compact' : 'product-visual placeholder'}
      style={{ background: `linear-gradient(145deg, ${accent}, color-mix(in srgb, ${accent} 55%, #041428))` }}
      role="img"
      aria-label={alt}
    >
      <em>{letter}</em>
    </span>
  );
}
