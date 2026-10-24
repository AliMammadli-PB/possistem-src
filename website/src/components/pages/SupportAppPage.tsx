'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { useI18n } from '@/components/providers/I18nProvider';

/** Download page for the support-desk Android app (staff only: it signs in with the console account). */
type Release = { versionName: string; apkUrl: string; sizeBytes: number; sha256: string; minSdk: number };

const FALLBACK: Release = {
  "versionName": "1.0.3",
  "apkUrl": "https://possistem.az/downloads/android/support/1.0.3/possistem-support-1.0.3.apk",
  "sizeBytes": 375196,
  "sha256": "4cafd0092fa11a2a2585499adf2597f2e80b6ba222696c58ce7fb9a86f01c1ce",
  "minSdk": 26
};

const COPY = {
  az: {
    crumb: 'Dəstək tətbiqi', home: 'Ana səhifə', support: 'Dəstək', eyebrow: 'ANDROID · DƏSTƏK KOMANDASI',
    title: 'Müştəri yazanda', accent: 'telefon zəng çalsın.',
    lead: 'Sorğu iş saatında bir əməkdaşın cihazına göndərilir. 30 saniyədə qəbul edilməsə, növbəti onlayn cihaza keçir. Qəbul et düyməsi yazışmanı açır.',
    download: 'APK-nı yüklə', back: 'Dəstək səhifəsi', flow: 'QURAŞDIRMA',
    steps: [['APK-nı yükləyin', 'Telefonda bu səhifəni açıb düyməyə basın.'], ['Quraşdırın və icazə verin', 'Bildiriş, batareya və tam ekran icazələrini qəbul edin.'], ['Daxil olun', 'Admin panelinin e-poçt və parolu ilə.']],
    whatTitle: 'Necə işləyir', whatBody: 'Tətbiq arxa planda işləyir və telefon yenidən açılanda özü başlayır.',
    what: ['Təyin olunan sorğular hər 5 saniyədən bir yoxlanılır; eyni sorğu bütün telefonlarda zəng çalmır', 'Standart iş vaxtı Bakı saatı ilə 10:00–18:00; kənar vaxtda mesaj saxlanılır', '30 saniyədə qəbul olunmayan sorğu növbəti uyğun cihaza ötürülür', 'Admin panelində iş vaxtını, cihaz adlarını və prioriteti dəyişin; bütün dəstək telefonlarını 1.0.3-ə yeniləyin'],
    specTitle: 'Fayl məlumatı', version: 'Versiya', size: 'Ölçü', android: 'Android', hash: 'SHA-256',
    note: 'Tətbiq yalnız possistem əməkdaşları üçündür: admin hesabı olmadan bildiriş gəlmir.',
  },
  en: {
    crumb: 'Support app', home: 'Home', support: 'Support', eyebrow: 'ANDROID · SUPPORT TEAM',
    title: 'When a customer writes,', accent: 'your phone rings.',
    lead: 'During work hours a request goes to one staff device. If not accepted within 30 seconds, it moves to the next available device. Tap Accept to open the conversation.',
    download: 'Download APK', back: 'Support page', flow: 'INSTALL',
    steps: [['Download the APK', 'Open this page on the phone and tap the button.'], ['Install and allow', 'Accept notification, battery and full-screen permissions.'], ['Sign in', 'With your admin console email and password.']],
    whatTitle: 'How it works', whatBody: 'The app runs in the background and starts again after a reboot.',
    what: ['Assigned requests are checked every 5 seconds; one request does not ring all phones', 'Default work hours are 10:00–18:00 Baku time; messages outside hours are saved', 'Unaccepted requests move to the next available device after 30 seconds', 'Set hours, device names and priorities in the admin panel; update all support phones to 1.0.3'],
    specTitle: 'File details', version: 'Version', size: 'Size', android: 'Android', hash: 'SHA-256',
    note: 'Staff only: without an admin account the app receives no alerts.',
  },
  ru: {
    crumb: 'Приложение поддержки', home: 'Главная', support: 'Поддержка', eyebrow: 'ANDROID · КОМАНДА ПОДДЕРЖКИ',
    title: 'Клиент написал —', accent: 'телефон звонит.',
    lead: 'В рабочее время запрос получает одно устройство. Если за 30 секунд его не приняли, запрос переходит следующему доступному сотруднику. Нажмите «Принять», чтобы открыть беседу.',
    download: 'Скачать APK', back: 'Страница поддержки', flow: 'УСТАНОВКА',
    steps: [['Скачайте APK', 'Откройте эту страницу на телефоне и нажмите кнопку.'], ['Установите и разрешите', 'Разрешите уведомления, работу в фоне и полноэкранный вызов.'], ['Войдите', 'С почтой и паролем админ-панели.']],
    whatTitle: 'Как это работает', whatBody: 'Приложение работает в фоне и запускается снова после перезагрузки.',
    what: ['Назначенные запросы проверяются каждые 5 секунд, без звонка на все телефоны', 'По умолчанию рабочие часы 10:00–18:00 по Баку; остальные сообщения сохраняются', 'Через 30 секунд непринятый запрос переходит следующему доступному устройству', 'Часы, названия устройств и приоритеты задаются в панели; обновите все телефоны поддержки до 1.0.3'],
    specTitle: 'О файле', version: 'Версия', size: 'Размер', android: 'Android', hash: 'SHA-256',
    note: 'Только для сотрудников: без аккаунта администратора уведомления не приходят.',
  },
};

export function SupportAppPage() {
  const { language } = useI18n();
  const c = COPY[language] ?? COPY.az;
  const [release, setRelease] = useState<Release>(FALLBACK);
  useEffect(() => {
    fetch('/downloads/android/support/latest.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Release | null) => { if (data?.apkUrl && data.versionName) setRelease(data); })
      .catch(() => undefined);
  }, []);
  const android = release.minSdk >= 26 ? '8.0+' : `API ${release.minSdk}+`;
  return (
    <MarketingLayout>
      <section className="page-hero">
        <div className="marketing-container page-hero-grid">
          <div>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href="/">{c.home}</Link><span>/</span><Link href="/destek/">{c.support}</Link><span>/</span><span>{c.crumb}</span>
            </nav>
            <span className="marketing-eyebrow">{c.eyebrow}</span>
            <h1>{c.title} <em>{c.accent}</em></h1>
            <p>{c.lead}</p>
            <div className="hero-actions">
              <a className="marketing-button primary" href={release.apkUrl} download>{c.download} · {release.versionName}</a>
              <Link className="marketing-button secondary" href="/destek/">{c.back}</Link>
            </div>
          </div>
          <div className="ps-workflow-receipt">
            <aside className="ps-workflow" aria-label={c.flow}>
              <span className="ps-workflow-label">{c.flow}</span>
              <ol>{c.steps.map(([title, body], i) => <li key={title}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{title}</strong><small>{body}</small></div></li>)}</ol>
            </aside>
          </div>
        </div>
      </section>
      <section className="marketing-section requirements-public">
        <div className="marketing-container requirements-public-grid">
          <div className="requirements-copy">
            <h2>{c.whatTitle}</h2>
            <p>{c.whatBody}</p>
            <ul className="check-list-public">{c.what.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{c.note}</p>
          </div>
          <dl className="requirement-cards">
            {[[c.version, release.versionName], [c.size, `${(release.sizeBytes / 1048576).toFixed(2)} MB`], [c.android, android], [c.hash, release.sha256]].map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd></div>
            ))}
          </dl>
        </div>
      </section>
    </MarketingLayout>
  );
}
