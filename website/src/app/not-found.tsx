'use client';

import Link from 'next/link';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { T } from '@/components/marketing/T';

export default function NotFound() {
  return (
    <MarketingLayout solidHeader>
      <section className="page-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <h1>
              <T k="404.text.004" />
            </h1>
            <p>
              <T k="404.text.005" />
            </p>
            <div className="hero-actions">
              <Link className="marketing-button primary" href="/">
                <T k="404.text.006" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
