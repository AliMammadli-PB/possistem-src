'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/components/providers/I18nProvider';
import { T } from './T';

const articles = [
  {
    searchKey: 'support.attr.030',
    category: 'support.text.031',
    title: 'support.text.032',
    body: 'support.text.033',
    link: '/pos/app/setup',
    linkLabel: 'support.text.034',
  },
  {
    searchKey: 'support.attr.035',
    category: 'support.text.036',
    title: 'support.text.037',
    body: 'support.text.038',
    link: '/melumatlar/#elaqe',
    linkLabel: 'support.text.039',
  },
  {
    searchKey: 'support.attr.040',
    category: 'support.text.041',
    title: 'support.text.042',
    body: 'support.text.043',
    link: '/yenilikler/',
    linkLabel: 'support.text.044',
  },
  {
    searchKey: 'support.attr.045',
    category: 'support.text.046',
    title: 'support.text.047',
    body: 'support.text.048',
    link: '/pos/app/integrations',
    linkLabel: 'support.text.049',
  },
  {
    searchKey: 'support.attr.050',
    category: 'support.text.051',
    title: 'support.text.052',
    body: 'support.text.053',
    link: '/pos/app/forgot-password',
    linkLabel: 'support.text.054',
  },
  {
    searchKey: 'support.attr.055',
    category: 'support.text.056',
    title: 'support.text.057',
    body: 'support.text.058',
    link: '/pos/app/integrations',
    linkLabel: 'support.text.059',
  },
];

export function SupportSearch() {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');

  const visibleCount = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return articles.length;
    return articles.filter((article) => {
      const haystack = `${t(article.searchKey)} ${t(article.category)} ${t(article.title)} ${t(article.body)}`.toLocaleLowerCase(locale);
      return haystack.includes(normalized);
    }).length;
  }, [query, locale, t]);

  const matches = (article: (typeof articles)[number]) => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return true;
    const haystack = `${t(article.searchKey)} ${t(article.category)} ${t(article.title)} ${t(article.body)}`.toLocaleLowerCase(locale);
    return haystack.includes(normalized);
  };

  return (
    <>
      <div className="public-search">
        <span className="inline-glyph" aria-hidden="true" />
        <input
          id="supportSearch"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('support.attr.027')}
          aria-label={t('support.attr.028')}
        />
        {query ? (
          <button id="clearSupportSearch" type="button" onClick={() => setQuery('')}>
            <T k="support.text.029" />
          </button>
        ) : null}
      </div>
      <div className="support-public-grid" id="supportArticles">
        {articles.map((article) => (
          <details key={article.title} hidden={!matches(article)} open={false}>
            <summary>
              <span>
                <b>
                  <T k={article.category} />
                </b>
                <strong>
                  <T k={article.title} />
                </strong>
              </span>
              <span className="inline-glyph" aria-hidden="true" />
            </summary>
            <div>
              <p>
                <T k={article.body} />
              </p>
              <Link href={article.link}>
                <T k={article.linkLabel} />
              </Link>
            </div>
          </details>
        ))}
      </div>
      {visibleCount === 0 ? (
        <div className="support-no-results">
          <strong>
            <T k="support.text.060" />
          </strong>
          <span>
            <T k="support.text.061" />
          </span>
        </div>
      ) : null}
    </>
  );
}
