'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';
import { T } from './T';

const PHONE_DISPLAY = '+994 51 333 35 55';

type ChannelId = 'alerts' | 'chat';

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

export function ShowcaseWhatsAppMock() {
  const { language, t } = useI18n();
  const [syncSec, setSyncSec] = useState(0);
  const [channel, setChannel] = useState<ChannelId>('alerts');
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    const tick = window.setInterval(() => setSyncSec((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const pulse = window.setInterval(() => {
      setHighlight(true);
      window.setTimeout(() => setHighlight(false), 1400);
    }, 16000);
    return () => window.clearInterval(pulse);
  }, []);

  const channels: Array<{ id: ChannelId; labelKey: string }> = [
    { id: 'alerts', labelKey: 'index.mock.tabAlerts' },
    { id: 'chat', labelKey: 'index.mock.waChannel' },
  ];

  return (
    <div className="ui-mock ui-mock--portal ui-mock--wa ui-mock--interactive" aria-label={t('index.mock.waTitle')}>
      <div className="ui-mock-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="ui-mock-head">
        <div className="ui-mock-head-copy">
          <strong className="ui-mock-title">
            <T k="index.mock.waTitle" />
          </strong>
          <small className="ui-mock-subtitle">
            <T k="index.mock.waSub" />
          </small>
        </div>
        <span className="ui-pill ui-pill--ok ui-pill--live">
          <span className="ui-live-dot" aria-hidden="true" />
          <T k="index.mock.statusConnected" />
        </span>
      </header>

      <p className="ui-mock-sync" role="status" aria-live="polite" aria-atomic="true">
        {formatSyncLabel(syncSec, language)}
      </p>

      <div className="ui-mock-tabs" role="tablist" aria-label={t('index.mock.waTitle')}>
        {channels.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={channel === entry.id}
            className={channel === entry.id ? 'is-active' : undefined}
            onClick={() => setChannel(entry.id)}
          >
            <T k={entry.labelKey} />
          </button>
        ))}
      </div>

      <div className="wa-connect" hidden={channel !== 'chat'}>
        <div className="wa-connect-mark" aria-hidden="true">
          <img src={asset('/assets/icons/whatsapp.svg')} alt="" width={22} height={22} />
        </div>
        <div className="wa-connect-copy">
          <span className="wa-connect-label">
            <T k="index.mock.waPhoneLabel" />
          </span>
          <p className="wa-connect-phone">{PHONE_DISPLAY}</p>
          <p className="wa-connect-sync">
            <T k="index.mock.waChannel" />
          </p>
        </div>
        <span className="wa-connect-badge" aria-hidden="true">
          <T k="index.mock.statusConnected" />
        </span>
      </div>

      {channel === 'alerts' ? (
        <ul className="ui-mock-feed">
          <li>
            <span className="ui-mock-icon ui-mock-icon--report" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={16} height={16}>
                <path
                  fill="currentColor"
                  d="M5 5h14v2H5V5Zm0 4h10v2H5V9Zm0 4h14v2H5v-2Zm0 4h8v2H5v-2Z"
                />
              </svg>
            </span>
            <div className="ui-mock-feed-copy">
              <b>
                <T k="index.mock.waMsg1Title" />
              </b>
              <small>
                <T k="index.mock.waMsg1Body" />
              </small>
            </div>
          </li>
          <li className={highlight ? 'is-highlight' : undefined}>
            <span className="ui-mock-icon ui-mock-icon--order" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={16} height={16}>
                <path
                  fill="currentColor"
                  d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3Zm1 4v5.6l3.2 1.9-.9 1.5L11 13V7h2Z"
                />
              </svg>
            </span>
            <div className="ui-mock-feed-copy">
              <b>
                <T k="index.mock.waMsg2Title" />
              </b>
              <small>
                <T k="index.mock.waMsg2Body" />
              </small>
            </div>
          </li>
          <li>
            <span className="ui-mock-icon ui-mock-icon--pos" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={16} height={16}>
                <path
                  fill="currentColor"
                  d="M12 2a5 5 0 0 1 5 5v1h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v1h6V7a3 3 0 0 0-3-3Z"
                />
              </svg>
            </span>
            <div className="ui-mock-feed-copy">
              <b>
                <T k="index.mock.waCheck1" />
              </b>
              <small>
                <T k="index.mock.salesAmount" />
              </small>
            </div>
          </li>
        </ul>
      ) : (
        <ul className="ui-mock-feed">
          <li>
            <span className="ui-mock-icon ui-mock-icon--pos" aria-hidden="true">
              <img src={asset('/assets/icons/whatsapp.svg')} alt="" width={16} height={16} />
            </span>
            <div className="ui-mock-feed-copy">
              <b>{PHONE_DISPLAY}</b>
              <small>
                <T k="index.mock.waChannel" />
              </small>
            </div>
          </li>
          <li className={highlight ? 'is-highlight' : undefined}>
            <span className="ui-mock-icon ui-mock-icon--report" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={16} height={16}>
                <path
                  fill="currentColor"
                  d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 17H9.8L5 20.2V17H7A2.5 2.5 0 0 1 4.5 14.5v-9Z"
                />
              </svg>
            </span>
            <div className="ui-mock-feed-copy">
              <b>
                <T k="index.mock.waOpenChat" />
              </b>
              <small>
                <T k="index.mock.waSub" />
              </small>
            </div>
          </li>
        </ul>
      )}

      <p className="ui-mock-summary">
        {channel === 'alerts'
          ? t('index.mock.activitySummary').replace('{count}', '3')
          : t('index.mock.waChannel')}
      </p>
    </div>
  );
}
