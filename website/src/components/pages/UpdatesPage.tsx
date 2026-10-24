'use client';

import Link from 'next/link';
import { WorkflowVisual } from '@/components/marketing/WorkflowVisual';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ReleaseCard } from '@/components/marketing/ReleaseCard';
import { T } from '@/components/marketing/T';

export function UpdatesPage() {
  return (
    <MarketingLayout solidHeader currentNav="updates">
      <section className="page-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <nav className="breadcrumbs">
              <Link href="/">
                <T k="updates.text.018" />
              </Link>
              <span>/</span>
              <span>
                <T k="updates.text.019" />
              </span>
            </nav>
            <span className="marketing-eyebrow">
              <T k="updates.text.020" />
            </span>
            <h1>
              <T k="updates.hero.heading" html />
            </h1>
            <p>
              <T k="updates.text.023" />
            </p>
            <div className="hero-actions">
              <Link className="marketing-button primary" href="/pos/app/login">
                <T k="updates.text.024" />
              </Link>
              <Link className="marketing-button secondary" href="/qurasdirma/">
                <T k="updates.text.025" />
              </Link>
            </div>
          </div>
          <WorkflowVisual kind="updates" />
        </div>
      </section>

      <section className="marketing-section latest-release-section">
        <div className="marketing-container">
          <ReleaseCard />
        </div>
      </section>

      <section className="marketing-section release-principles">
        <div className="marketing-container">
          <header className="marketing-heading reveal">
            <div>
              <span className="marketing-eyebrow">
                <T k="updates.text.038" />
              </span>
              <h2>
                <T k="updates.text.039" />
              </h2>
            </div>
            <p>
              <T k="updates.text.040" />
            </p>
          </header>
          <div className="principle-grid">
            {[
              ['SHA', 'updates.text.041', 'updates.text.042'],
              ['DL', 'updates.text.043', 'updates.text.044'],
              ['SYNC', 'updates.text.045', 'updates.text.046'],
            ].map(([symbol, title, body]) => (
              <article key={title} className="reveal">
                <span>
                  <span className="premium-symbol" aria-hidden="true">
                    {symbol}
                  </span>
                </span>
                <h3>
                  <T k={title} />
                </h3>
                <p>
                  <T k={body} />
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container story-grid reverse-layout">
          <div className="story-copy reveal">
            <span className="marketing-eyebrow">
              <T k="updates.text.047" />
            </span>
            <h2>
              <T k="updates.text.048" />
            </h2>
            <p>
              <T k="updates.text.049" />
            </p>
            <ul className="check-list-public">
              {['updates.text.050', 'updates.text.051', 'updates.text.052', 'updates.text.053'].map((key) => (
                <li key={key}>
                  <T k={key} />
                </li>
              ))}
            </ul>
          </div>
          <WorkflowVisual kind="updates" />
        </div>
      </section>

      <section className="marketing-cta">
        <div className="marketing-container cta-inner">
          <div>
            <span className="marketing-eyebrow">
              <T k="updates.text.055" />
            </span>
            <h2>
              <T k="updates.text.056" />
            </h2>
            <p>
              <T k="updates.text.057" />
            </p>
          </div>
          <div>
            <Link className="marketing-button primary" href="/pos/app/login">
              <T k="updates.text.058" />
            </Link>
            <Link className="marketing-button secondary" href="/destek/">
              <T k="updates.text.059" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
