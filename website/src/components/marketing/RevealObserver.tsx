'use client';

import { useEffect } from 'react';

export function RevealObserver() {
  useEffect(() => {
    document.documentElement.classList.add('js', 'site-ready');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealItems = document.querySelectorAll<HTMLElement>('.reveal');

    const markVisible = (item: Element) => {
      item.classList.add('visible');
    };

    if (reducedMotion || typeof window.IntersectionObserver !== 'function') {
      revealItems.forEach(markVisible);
      return;
    }

    const delayByParent = new WeakMap<Element, number>();

    revealItems.forEach((item) => {
      const parent = item.parentElement;
      if (!parent) return;
      const index = delayByParent.get(parent) ?? 0;
      delayByParent.set(parent, index + 1);
      item.style.setProperty('--reveal-delay', `${Math.min(index, 5) * 70}ms`);
    });

    const observer = new IntersectionObserver(
      (entries, instance) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          markVisible(entry.target);
          instance.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -4% 0px', threshold: 0.02 },
    );

    revealItems.forEach((item) => observer.observe(item));

    // Safety: never leave mid-page stuck at opacity 0 if IO misses
    const safety = window.setTimeout(() => {
      revealItems.forEach((item) => {
        if (!item.classList.contains('visible')) markVisible(item);
      });
    }, 2800);

    return () => {
      observer.disconnect();
      window.clearTimeout(safety);
    };
  }, []);

  return null;
}
