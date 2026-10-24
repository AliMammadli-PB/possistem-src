'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkflowVisual } from '@/components/marketing/WorkflowVisual';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { ReleaseCard } from '@/components/marketing/ReleaseCard';
import { T } from '@/components/marketing/T';

const steps = [
  ['setup.text.031', 'setup.text.032'],
  ['setup.text.033', 'setup.text.034'],
  ['setup.text.035', 'setup.text.036'],
  ['setup.text.037', 'setup.text.038'],
  ['setup.text.039', 'setup.text.040'],
  ['setup.text.041', 'setup.text.042'],
  ['setup.text.043', 'setup.text.044'],
];

type AndroidRelease = { versionName: string; apkUrl: string; sizeBytes: number };

/** Customer portal app; version and link come from the update feed the app itself uses. */
function CustomerAndroidCard() {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  useEffect(() => {
    fetch('/downloads/android/customer/latest.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => setRelease(null));
  }, []);
  if (!release) return null;
  return (
    <div className="public-release-card" style={{ marginTop: 20 }}>
      <a href="/" aria-label="Possistem" className="public-release-icon"><img src="/assets/brands/logo.png" width="48" height="48" alt="" /></a>
      <div className="public-release-copy">
        <span className="marketing-eyebrow">ANDROID</span>
        <h2>POSSİSTEM müştəri tətbiqi</h2>
        <p>Müştəri panelinizi telefondan izləyin: kassa vəziyyəti, lisenziya və yükləmələr. Android 8 və yuxarı · {release.versionName} · {(release.sizeBytes / 1048576).toFixed(1)} MB</p>
        <p>Samsung telefonlarda quraşdırmadan əvvəl Ayarlar → Təhlükəsizlik və məxfilik → Avtomatik bloklayıcı müvəqqəti söndürülməlidir.</p>
      </div>
      <a className="marketing-button primary" href={release.apkUrl}>APK-nı yüklə ↓</a>
    </div>
  );
}

export function SetupPage() {
  return (
    <MarketingLayout solidHeader currentNav="setup">
      <section className="page-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/">
                <T k="setup.text.019" />
              </Link>
              <span>/</span>
              <span>
                <T k="setup.text.020" />
              </span>
            </nav>
            <span className="marketing-eyebrow">
              <T k="setup.text.021" />
            </span>
            <h1>
              <T k="setup.hero.heading" html />
            </h1>
            <p>
              <T k="setup.text.024" />
            </p>
            <div className="hero-actions">
              <Link className="marketing-button primary" href="/pos/app/login">
                <T k="setup.text.025" />
              </Link>
              <Link className="marketing-button secondary" href="/pos/app/login">
                <T k="setup.text.026" />
              </Link>
            </div>
          </div>
          <WorkflowVisual kind="setup" />
        </div>
      </section>

      <section className="marketing-section latest-release-section">
        <div className="marketing-container">
          <ReleaseCard />
          <CustomerAndroidCard />
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container">
          <header className="marketing-heading centered reveal">
            <div>
              <span className="marketing-eyebrow">
                <T k="setup.text.028" />
              </span>
              <h2>
                <T k="setup.text.029" />
              </h2>
            </div>
            <p>
              <T k="setup.text.030" />
            </p>
          </header>
          <div className="setup-public-steps">
            {steps.map(([title, body], index) => (
              <article key={title} className="reveal">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>
                    <T k={title} />
                  </h3>
                  <p>
                    <T k={body} />
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section setup-preview-section">
        <div className="marketing-container story-grid">
          <div className="story-copy reveal">
            <span className="marketing-eyebrow">
              <T k="setup.text.045" />
            </span>
            <h2>
              <T k="setup.text.046" />
            </h2>
            <p>
              <T k="setup.text.047" />
            </p>
            <ul className="check-list-public">
              {['setup.text.048', 'setup.text.049', 'setup.text.050', 'setup.text.051'].map((key) => (
                <li key={key}>
                  <T k={key} />
                </li>
              ))}
            </ul>
          </div>
          <WorkflowVisual kind="setup" />
        </div>
      </section>

      <section className="marketing-section requirements-public">
        <div className="marketing-container requirements-public-grid">
          <div className="requirements-copy reveal">
            <span className="marketing-eyebrow">
              <T k="setup.text.053" />
            </span>
            <h2>
              <T k="setup.text.054" />
            </h2>
            <p>
              <T k="setup.text.055" />
            </p>
            <Link className="marketing-link" href="/yenilikler/">
              <T k="setup.text.056" /> <span className="inline-glyph" aria-hidden="true" />
            </Link>
          </div>
          <dl className="requirement-cards reveal">
            {[
              ['setup.text.057', 'setup.text.058'],
              ['setup.hw.cpu', 'setup.hw.cpuValue'],
              ['setup.text.061', 'setup.text.062'],
              ['setup.hw.gpu', 'setup.hw.gpuValue'],
              ['setup.text.063', 'setup.text.064'],
              ['setup.text.065', 'setup.text.066'],
              ['setup.text.059', 'setup.text.060'],
              ['setup.text.067', 'setup.text.068'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>
                  <T k={label} />
                </dt>
                <dd>
                  <T k={value} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="marketing-section verification-section">
        <div className="marketing-container verification-grid">
          <WorkflowVisual kind="setup" />
          <div className="verification-copy reveal">
            <span className="marketing-eyebrow">
              <T k="setup.text.070" />
            </span>
            <h2>
              <T k="setup.text.071" />
            </h2>
            <p>
              <T k="setup.text.072" />
            </p>
            <div className="verify-states">
              {[
                ['neutral', 'setup.text.073', 'setup.text.074'],
                ['warning', 'setup.text.075', 'setup.text.076'],
                ['success', 'setup.text.077', 'setup.text.078'],
              ].map(([dot, title, body]) => (
                <div key={title}>
                  <span className={`dot ${dot}`} />
                  <p>
                    <strong>
                      <T k={title} />
                    </strong>
                    <small>
                      <T k={body} />
                    </small>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-cta">
        <div className="marketing-container cta-inner">
          <div>
            <span className="marketing-eyebrow">
              <T k="setup.text.079" />
            </span>
            <h2>
              <T k="setup.text.080" />
            </h2>
            <p>
              <T k="setup.text.081" />
            </p>
          </div>
          <div>
            <Link className="marketing-button primary" href="/pos/app/login">
              <T k="setup.text.082" />
            </Link>
            <Link className="marketing-button secondary" href="/destek/">
              <T k="setup.text.083" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
