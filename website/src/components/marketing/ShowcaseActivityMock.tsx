'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { T } from './T';

type TabId = 'all' | 'alerts' | 'account';
type FeedTone = 'pos' | 'report' | 'order';

type FeedItem = {
  id: string;
  tabs: TabId[];
  tone: FeedTone;
  titleKey: string;
  detailKey: string;
};

const FEED: FeedItem[] = [
  {
    id: 'pos',
    tabs: ['all', 'account'],
    tone: 'pos',
    titleKey: 'index.mock.posOnline',
    detailKey: 'index.mock.posIp',
  },
  {
    id: 'sales',
    tabs: ['all', 'alerts'],
    tone: 'report',
    titleKey: 'index.mock.salesReport',
    detailKey: 'index.mock.salesAmount',
  },
  {
    id: 'order',
    tabs: ['all', 'alerts'],
    tone: 'order',
    titleKey: 'index.mock.newOrder',
    detailKey: 'index.mock.tableOrder',
  },
];

function MockIcon({ tone }: { tone: FeedTone }) {
  const paths = {
    pos: (
      <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H4V7Zm0 4h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6Zm4 2v2h8v-2H8Z"
        />
      </svg>
    ),
    report: (
      <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 5h14v2H5V5Zm0 4h10v2H5V9Zm0 4h14v2H5v-2Zm0 4h8v2H5v-2Z"
        />
      </svg>
    ),
    order: (
      <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
        <path
          fill="currentColor"
          d="M7 3h10a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2Zm2 6h6v2H9V9Zm0 4h4v2H9v-2Z"
        />
      </svg>
    ),
  };
  return <span className={`ui-mock-icon ui-mock-icon--${tone}`}>{paths[tone]}</span>;
}

function formatSyncLabel(seconds: number, language: string) {
  if (seconds < 8) {
    return language === 'az' ? 'İndi sinxron' : language === 'ru' ? 'Сейчас синхронизировано' : 'Synced now';
  }
  if (seconds < 60) {
    return language === 'az'
      ? `${seconds} saniyə əvvəl sinxron`
      : language === 'ru'
        ? `Синхрон ${seconds} сек назад`
        : `Synced ${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return language === 'az'
    ? `${minutes} dəq əvvəl sinxron`
    : language === 'ru'
      ? `Синхрон ${minutes} мин назад`
      : `Synced ${minutes}m ago`;
}

export function ShowcaseActivityMock() {
  const { language, t } = useI18n();
  const [tab, setTab] = useState<TabId>('all');
  const [syncSec, setSyncSec] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setSyncSec((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const pulse = window.setInterval(() => {
      setHighlightId('order');
      window.setTimeout(() => setHighlightId(null), 1400);
    }, 16000);
    return () => window.clearInterval(pulse);
  }, []);

  const items = useMemo(() => FEED.filter((item) => item.tabs.includes(tab)), [tab]);

  const tabs: Array<{ id: TabId; labelKey: string }> = [
    { id: 'all', labelKey: 'index.mock.tabAll' },
    { id: 'alerts', labelKey: 'index.mock.tabAlerts' },
    { id: 'account', labelKey: 'index.mock.tabAccount' },
  ];

  return (
    <div className="ui-mock ui-mock--portal ui-mock--interactive" aria-label={t('index.mock.activityTitle')}>
      <div className="ui-mock-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <header className="ui-mock-head">
        <div className="ui-mock-head-copy">
          <strong className="ui-mock-title">
            <T k="index.mock.activityTitle" />
          </strong>
          <small className="ui-mock-subtitle">
            <T k="index.mock.activitySub" />
          </small>
        </div>
        <span className="ui-pill ui-pill--ok ui-pill--live">
          <span className="ui-live-dot" aria-hidden="true" />
          <T k="index.mock.statusOnline" />
        </span>
      </header>
      <p className="ui-mock-sync" role="status" aria-live="polite" aria-atomic="true">
        {formatSyncLabel(syncSec, language)}
      </p>
      <div className="ui-mock-tabs" role="tablist" aria-label={t('index.mock.activityTitle')}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'is-active' : undefined}
            onClick={() => setTab(entry.id)}
          >
            <T k={entry.labelKey} />
          </button>
        ))}
      </div>
      <ul className="ui-mock-feed">
        {items.map((item) => (
          <li key={item.id} className={highlightId === item.id ? 'is-highlight' : undefined}>
            <MockIcon tone={item.tone} />
            <div className="ui-mock-feed-copy">
              <b>
                <T k={item.titleKey} />
              </b>
              <small>
                <T k={item.detailKey} />
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="ui-mock-summary">{t('index.mock.activitySummary').replace('{count}', String(items.length))}</p>
    </div>
  );
}
