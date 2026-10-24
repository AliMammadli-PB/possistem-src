import { useEffect, useState } from 'react';

/** Older embedded Chromium builds may have only the legacy media listener API. */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  if (typeof window.matchMedia !== 'function') { onChange(false); return () => {}; }
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const update = () => onChange(query.matches);
  update();
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }
  query.addListener?.(update);
  return () => query.removeListener?.(update);
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => watchReducedMotion(setReduced), []);
  return reduced;
}
