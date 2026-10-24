'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';
import { T } from './T';

const REQUIREMENTS = [
  { id: 'os', key: 'index.mock.dlReqOs' },
  { id: 'cpu', key: 'index.mock.dlReqCpu' },
  { id: 'ram', key: 'index.mock.dlReqRam' },
  { id: 'gpu', key: 'index.mock.dlReqGpu' },
] as const;

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 11.4 2.9 8.1l1.2-1.2 2.1 2.1 5.7-5.7 1.2 1.2z"
      />
    </svg>
  );
}

function formatFileLine(version: string, sizeMb: number, locale: string) {
  const size =
    locale === 'az' || locale === 'ru'
      ? `${sizeMb} MB`
      : `${sizeMb} MB`;
  return `Possistem-Setup-${version}.exe · ${size}`;
}

export function ShowcaseDownloadsMock() {
  const { t, locale } = useI18n();
  const [versionLabel, setVersionLabel] = useState(t('index.mock.dlVersion'));
  const [fileLine, setFileLine] = useState(t('index.mock.dlFile'));

  useEffect(() => {
    let cancelled = false;
    void fetch('/pos-updates/latest.yml', { headers: { Accept: 'text/plain' } })
      .then(async (response) => {
        if (!response.ok) return;
        const text = await response.text();
        const version = text.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
        const fileSize = Number(text.match(/^\s*size:\s*(\d+)/m)?.[1] ?? 0);
        if (!version || cancelled) return;
        const sizeMb = fileSize ? Math.round(fileSize / (1024 * 1024)) : 0;
        setVersionLabel(
          locale === 'ru' ? `Версия ${version}` : locale === 'en' ? `Version ${version}` : `Versiya ${version}`,
        );
        if (sizeMb) setFileLine(formatFileLine(version, sizeMb, locale));
      })
      .catch(() => {
        /* keep static i18n fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="ui-mock ui-mock--portal ui-mock--downloads ui-mock--interactive" aria-label={t('image.home.downloads')}>
      <div className="ui-mock-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="dl-chrome">
        <a href="/" aria-label="Possistem" className="dl-chrome-brand" style={{textDecoration:'none',color:'inherit'}}>
          <img src={asset('/assets/brands/logo.png')} alt="" width={22} height={22} />
          <strong>
            <T k="index.text.132" />
          </strong>
        </a>
        <span className="dl-chrome-account">
          <T k="index.mock.dlAccount" />
        </span>
      </header>

      <div className="dl-stage">
        <div className="dl-pack">
          <div className="dl-title-row">
            <strong className="dl-title">
              <T k="index.mock.dlTitle" />
            </strong>
            <span className="dl-version">{versionLabel}</span>
          </div>
          <p className="dl-file">{fileLine}</p>
          <span className="dl-cta">
            <T k="index.mock.dlCta" />
          </span>
        </div>

        <div className="dl-reqs">
          <p className="dl-reqs-title">
            <T k="index.mock.dlReqTitle" />
          </p>
          <ul>
            {REQUIREMENTS.map((row) => (
              <li key={row.id}>
                <span className="dl-check">
                  <CheckMark />
                </span>
                <span>
                  <T k={row.key} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
