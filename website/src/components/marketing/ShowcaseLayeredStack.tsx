'use client';

import Link from 'next/link';
import { T } from '@/components/marketing/T';
import { asset } from '@/lib/assets';
import { customerLoginUrl } from '@/lib/customer-auth-url';

export function ShowcaseLayeredStack() {
  return (
    <div className="showcase-layered reveal">
      <div className="showcase-layered__frame" aria-label="possistem kassa və portal">
        <div className="r-canvas showcase-layered__canvas" aria-hidden="true">
          <img src={asset('/assets/plates/canvas.png')} alt="" width={1024} height={1024} />
        </div>

        <a href="/" aria-label="Possistem" className="r-logo showcase-layered__brand" style={{textDecoration:'none',color:'inherit'}}>
          <img src={asset('/assets/brands/logo.png')} alt="" width={28} height={28} />
          <strong>Possistem</strong>
        </a>

        <h2 className="r-headline showcase-layered__title">
          <T k="index.layered.headline" html />
        </h2>

        <p className="r-lede showcase-layered__lede">
          <T k="index.layered.lede" />
        </p>

        <div className="showcase-layered__actions">
          <Link className="r-cta-download marketing-button primary showcase-layered__cta-dl" href="/qurasdirma/">
            <T k="index.layered.ctaDownload" />
          </Link>
          <Link
            className="r-cta-portal marketing-button secondary showcase-layered__cta-portal"
            href={customerLoginUrl()}
          >
            <T k="index.layered.ctaPortal" />
          </Link>
        </div>

        <img
          className="r-portal-sheet showcase-layered__portal"
          src={asset('/assets/plates/portal-sheet.png')}
          alt=""
          width={1536}
          height={1024}
        />
        <img
          className="r-till-device showcase-layered__till"
          src={asset('/assets/plates/till-device.png')}
          alt=""
          width={1536}
          height={1024}
        />

        <ul className="r-feature-row showcase-layered__features">
          <li>
            <span className="showcase-layered__feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-5l-3 3-3-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8h4.8L12 17.2 14.2 15H19V7H5Z"
                />
              </svg>
            </span>
            <span>
              <T k="index.layered.featFast" />
            </span>
          </li>
          <li>
            <span className="showcase-layered__feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M4 19h2V9H4v10Zm5 0h2V5H9v14Zm5 0h2v-7h-2v7Zm5 0h2V8h-2v11Z" />
              </svg>
            </span>
            <span>
              <T k="index.layered.featLive" />
            </span>
          </li>
          <li>
            <span className="showcase-layered__feat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 2.2 6 2.2v4.6c0 3.9-2.5 7.3-6 8.7-3.5-1.4-6-4.8-6-8.7V6.4l6-2.2Z"
                />
              </svg>
            </span>
            <span>
              <T k="index.layered.featSafe" />
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
