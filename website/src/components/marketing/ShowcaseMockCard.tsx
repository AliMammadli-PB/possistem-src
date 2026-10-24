import Link from 'next/link';
import type { ReactNode } from 'react';
import { T } from './T';

type ShowcaseMockCardProps = {
  href: string;
  eyebrowKey: string;
  titleKey: string;
  children: ReactNode;
  className?: string;
};

export function ShowcaseMockCard({ href, eyebrowKey, titleKey, children, className = '' }: ShowcaseMockCardProps) {
  return (
    <figure className={`showcase-mock-card reveal ${className}`.trim()}>
      {children}
      <Link className="showcase-mock-card__foot" href={href}>
        <span className="showcase-mock-card__eyebrow">
          <T k={eyebrowKey} />
        </span>
        <strong className="showcase-mock-card__title">
          <T k={titleKey} />
        </strong>
        <span className="showcase-mock-card__arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </figure>
  );
}
