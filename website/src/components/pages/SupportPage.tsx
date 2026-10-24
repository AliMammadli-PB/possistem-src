'use client';

import Link from 'next/link';
import { WorkflowVisual } from '@/components/marketing/WorkflowVisual';
import { openSupportChat } from '@/components/marketing/SupportChatWidget';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { SupportSearch } from '@/components/marketing/SupportSearch';
import { T } from '@/components/marketing/T';
import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';
import { whatsappSupportUrl } from '@/lib/whatsapp';

export function SupportPage() {
  const { language } = useI18n();
  return (
    <MarketingLayout solidHeader currentNav="support">
      <section className="page-hero support-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <nav className="breadcrumbs">
              <Link href="/">
                <T k="support.text.018" />
              </Link>
              <span>/</span>
              <span>
                <T k="support.text.019" />
              </span>
            </nav>
            <span className="marketing-eyebrow">
              <T k="support.text.020" />
            </span>
            <h1>
              <T k="support.hero.heading" html />
            </h1>
            <p>
              <T k="support.text.023" />
            </p>
            <div className="hero-actions">
              <button type="button" className="marketing-button primary" onClick={openSupportChat}>
                {({ az: 'Köməkçiyə yazın', en: 'Ask the assistant', ru: 'Написать помощнику' } as const)[language]}
              </button>
              <a className="marketing-button secondary" href={whatsappSupportUrl(language)} target="_blank" rel="noopener noreferrer">
                <T k="support.text.025" />
              </a>
              <a className="marketing-button secondary" href="mailto:support@possistem.az?subject=possistem%20dəstək">
                <T k="support.text.081" />
              </a>
            </div>
          </div>
          <WorkflowVisual kind="support" />
        </div>
      </section>

      <section className="marketing-section support-public-section">
        <div className="marketing-container">
          <SupportSearch />
        </div>
      </section>

      <section className="marketing-section support-channels">
        <div className="marketing-container">
          <header className="marketing-heading reveal">
            <div>
              <span className="marketing-eyebrow">
                <T k="support.text.062" />
              </span>
              <h2>
                <T k="support.text.063" />
              </h2>
            </div>
            <p>
              <T k="support.text.083" />
            </p>
          </header>
          <div className="support-contact-grid">
            <a
              className="support-contact-card reveal"
              href={whatsappSupportUrl(language)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="channel-icon">
                <img src={asset('/assets/icons/whatsapp.svg')} alt="" width={28} height={28} />
              </span>
              <h3>
                <T k="support.text.025" />
              </h3>
              <p>
                <T k="support.text.066" />
              </p>
              <span className="support-contact-action">051 333 35 55</span>
            </a>
            <a className="support-contact-card reveal" href="mailto:support@possistem.az?subject=possistem%20dəstək">
              <span className="channel-icon">
                <span className="premium-symbol" aria-hidden="true">
                  @
                </span>
              </span>
              <h3>
                <T k="support.text.081" />
              </h3>
              <p>
                <T k="support.text.082" />
              </p>
              <span className="support-contact-action">support@possistem.az</span>
            </a>
          </div>

          <div className="support-account-links reveal">
            <p className="support-account-label">
              <T k="support.text.084" />
            </p>
            <div className="support-account-actions">
              <Link href="/pos/app/login">
                <T k="support.text.024" />
              </Link>
              <Link href="/pos/app/settings/notifications">
                <T k="support.text.069" />
              </Link>
              <Link href="/pos/app/support">
                <T k="support.text.072" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section secure-support-section">
        <div className="marketing-container story-grid">
          <WorkflowVisual kind="support" />
          <div className="story-copy reveal">
            <span className="marketing-eyebrow">
              <T k="support.text.074" />
            </span>
            <h2>
              <T k="support.text.075" />
            </h2>
            <p>
              <T k="support.text.076" />
            </p>
            <ul className="check-list-public">
              {['support.text.077', 'support.text.078', 'support.text.079', 'support.text.080'].map((key) => (
                <li key={key}>
                  <T k={key} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
