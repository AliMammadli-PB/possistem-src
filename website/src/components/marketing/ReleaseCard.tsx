'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/providers/I18nProvider';
import { T } from '@/components/marketing/T';

type ReleaseInfo = {
  version: string;
  size: string;
  date: string;
  downloadHref: string;
};

function parseRelease(text: string, locale: string): ReleaseInfo {
  const nextVersion = text.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  const fileSize = Number(text.match(/^\s*size:\s*(\d+)/m)?.[1] ?? 0);
  const releaseDate = text.match(/^releaseDate:\s*['"]?([^'"\r\n]+)['"]?/m)?.[1]?.trim();
  const path =
    text.match(/^path:\s*['"]?([^\s'"]+)/m)?.[1] ||
    text.match(/^\s*-\s*url:\s*['"]?([^\s'"]+)/m)?.[1];
  if (!nextVersion) throw new Error('release invalid');
  const fileName = path?.replace(/^.*\//, '') || `Possistem-Setup-${nextVersion}.exe`;
  return {
    version: `v${nextVersion}`,
    size: fileSize ? `${Math.round(fileSize / (1024 * 1024))} MB` : '—',
    date: releaseDate ? new Date(releaseDate).toLocaleDateString(locale) : '—',
    downloadHref: `/pos-updates/${encodeURIComponent(fileName)}`,
  };
}

export function ReleaseCard() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    void fetch('/pos-updates/latest.yml', { headers: { Accept: 'text/plain' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('release unavailable');
        const text = await response.text();
        setRelease(parseRelease(text, locale));
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [locale]);

  if (error) {
    return (
      <div className="release-error" role="status">
        <strong>
          <T k="updates.text.036" />
        </strong>
        <span>
          <T k="updates.text.037" />
        </span>
      </div>
    );
  }

  return (
    <div className="public-release-card reveal" aria-busy={loading}>
      <div className="public-release-icon">
        <span className="premium-symbol" aria-hidden="true">
          WIN
        </span>
      </div>
      <div className="public-release-copy">
        <span className="marketing-eyebrow">
          <T k="updates.text.027" />
        </span>
        <h2>
          <T k="updates.text.028" /> <code>{loading || !release ? t('updates.text.029') : release.version}</code>
        </h2>
        <p>{loading ? <T k="updates.text.030" /> : t('updates.releaseStatus')}</p>
        <div className="release-facts">
          <span>
            <small>
              <T k="updates.text.031" />
            </small>
            <strong>
              <T k="updates.text.032" />
            </strong>
          </span>
          <span>
            <small>
              <T k="updates.text.033" />
            </small>
            <strong>{release?.size ?? '—'}</strong>
          </span>
          <span>
            <small>
              <T k="updates.text.034" />
            </small>
            <strong>{release?.date ?? '—'}</strong>
          </span>
        </div>
      </div>
      {release?.downloadHref ? (
        <a className="marketing-button primary" href={release.downloadHref} download>
          <T k="updates.text.035" />
        </a>
      ) : (
        <Link className="marketing-button primary" href="/pos/app/login">
          <T k="updates.text.035" />
        </Link>
      )}
    </div>
  );
}
