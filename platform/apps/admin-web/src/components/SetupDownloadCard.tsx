import { useLiveEffect } from '../lib/live';
import {  useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import { useProduct } from '../lib/product';

type SetupInfo = {
  version: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number | null;
  feedUrl: string;
  productName: string;
};

function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function SetupDownloadCard() {
  const t = useI18n();
  const { product } = useProduct();
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useLiveEffect(() => {
    setLoading(true);
    void api<SetupInfo>(`/downloads/setup?product=${product}`)
      .then((data) => {
        setInfo(data);
        setError(null);
      })
      .catch((err) => {
        setInfo(null);
        setError(err instanceof ApiError ? err.message : t.downloads.unavailable);
      })
      .finally(() => setLoading(false));
  }, [product, t.downloads.unavailable]);

  return (
    <section className="card download-card">
      <h2>{t.downloads.title}</h2>
      <p className="muted">{t.downloads.hint}</p>
      {loading && <p className="muted">{t.downloads.loading}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <>
          <dl className="kv">
            <dt>{t.downloads.version}</dt>
            <dd className="mono">{info.version}</dd>
            <dt>{t.downloads.size}</dt>
            <dd>{formatBytes(info.sizeBytes)}</dd>
            <dt>Fayl</dt>
            <dd className="mono">{info.fileName}</dd>
          </dl>
          <div className="download-actions">
            <a className="btn primary" href={info.downloadUrl} download={info.fileName}>
              {t.downloads.download}
            </a>
            <a className="btn ghost" href={info.feedUrl} target="_blank" rel="noreferrer">
              {t.downloads.openFeed}
            </a>
          </div>
        </>
      )}
    </section>
  );
}
