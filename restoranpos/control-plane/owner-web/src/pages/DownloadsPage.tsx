import { useEffect, useState } from 'react';
import { formatBytes, latestSetup, recordSetupDownload, type SetupInfo } from '../api';
import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/navigation';
import { Alert, Badge, Button, Card, ErrorState, Skeleton, Tooltip } from '../ui/primitives';
import { WindowsRequirements } from '../ui/WindowsRequirements';
import { useToast } from '../ui/overlays';

export default function DownloadsPage() {
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const { show } = useToast();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setSetup(await latestSetup());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Yükləmə məlumatı alınmadı.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const download = async () => {
    setDownloading(true);
    try {
      const result = await recordSetupDownload();
      show({ tone: 'success', title: 'Yükləmə başlayır', message: `${result.setup.fileName} brauzerə göndərildi.` });
      window.location.assign(result.setup.downloadUrl);
    } catch (cause) {
      show({ tone: 'danger', title: 'Yükləmə başlamadı', message: cause instanceof Error ? cause.message : undefined });
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <DownloadsSkeleton />;
  if (error || !setup) {
    return <ErrorState title="Yükləmə məlumatı əlçatan deyil" description={error || 'Bir qədər sonra yenidən yoxlayın.'} action={<Button icon="refresh" onClick={() => void load()}>Yenidən yoxla</Button>} />;
  }

  const productLabel = ({ possistem: 'Restoran POS', MarketPos: 'Market POS', GeyimPos: 'Geyim POS', AptekPos: 'Aptek POS', TopdanPos: 'Topdan POS' } as Record<string, string>)[setup.productName] || setup.productName;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Proqram təminatı"
        title="Yükləmələr və yeniləmələr"
        description={`${productLabel} üçün yoxlanılmış son stabil Windows quraşdırıcısı.`}
      />

      <Card className="release-card">
        <div className="release-art" aria-hidden="true">
          <Icon name="windows" size={42} />
          <div><span /><span /><span /><span /></div>
        </div>
        <div className="release-content">
          <div className="release-labels"><Badge tone="success">Stabil buraxılış</Badge><span>Windows · x64</span></div>
          <h2>{productLabel} <span className="mono">v{setup.version}</span></h2>
          <p>{setup.productName === 'possistem' ? 'Restoran kassası, masa idarəetməsi və server sinxronizasiyası üçün tam Windows qurulumu.' : `${productLabel} üçün satış, barkod və stok idarəetməsi ilə tam Windows qurulumu.`}</p>
          <dl className="release-meta">
            <div><dt>Fayl</dt><dd className="mono">{setup.fileName}</dd></div>
            <div><dt>Ölçü</dt><dd>{formatBytes(setup.sizeBytes)}</dd></div>
            <div><dt>Buraxılış</dt><dd>{setup.releaseDate ? new Date(setup.releaseDate).toLocaleString('az-AZ') : 'Son stabil versiya'}</dd></div>
          </dl>
          <div className="button-row">
            <Button variant="primary" icon="download" loading={downloading} onClick={() => void download()}>Windows üçün yüklə</Button>
            <a className="button button-secondary button-md" href={setup.feedUrl} target="_blank" rel="noreferrer"><Icon name="external" size={18} /><span>Update məlumatı</span></a>
          </div>
        </div>
      </Card>

      <div className="two-column-grid">
        <Card>
          <div className="card-heading"><div><span className="section-eyebrow">Uyğunluq</span><h2>Sistem tələbləri</h2></div><Icon name="monitor" size={24} /></div>
          <dl className="key-values requirements-list">
            <div><dt>Əməliyyat sistemi</dt><dd>{setup.requirements.operatingSystem}</dd></div>
            <div><dt>Arxitektura</dt><dd>{setup.requirements.architecture}</dd></div>
            {setup.requirements.cpu ? <div><dt>Prosessor (CPU)</dt><dd>{setup.requirements.cpu}</dd></div> : null}
            <div><dt>Yaddaş (RAM)</dt><dd>{setup.requirements.memory}</dd></div>
            <div><dt>Disk</dt><dd>{setup.requirements.diskSpace}</dd></div>
            {setup.requirements.gpu ? <div><dt>Qrafika / NVIDIA</dt><dd>{setup.requirements.gpu}</dd></div> : null}
            {setup.requirements.display ? <div><dt>Ekran</dt><dd>{setup.requirements.display}</dd></div> : null}
            <div><dt>Bağlantı</dt><dd>{setup.requirements.internet}</dd></div>
          </dl>
        </Card>

        <Card>
          <div className="card-heading"><div><span className="section-eyebrow">Fayl bütövlüyü</span><h2>Yoxlama cəmi</h2></div><Icon name="shield" size={24} /></div>
          <p className="muted-copy">Texniki dəstək quraşdırma faylını yoxlamağı xahiş edərsə, bu SHA-512 dəyərindən istifadə edin.</p>
          {setup.sha512 ? (
            <div className="checksum">
              <code>{setup.sha512}</code>
              <Tooltip label="Kopyala">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="copy"
                  onClick={() => {
                    void navigator.clipboard.writeText(setup.sha512 || '');
                    show({ tone: 'success', title: 'Yoxlama cəmi kopyalandı' });
                  }}
                >
                  Kopyala
                </Button>
              </Tooltip>
            </div>
          ) : <Alert tone="warning" title="Yoxlama cəmi yoxdur">Bu buraxılış üçün checksum update feed-də dərc edilməyib.</Alert>}
        </Card>
      </div>

      <WindowsRequirements />

      <Card>
        <div className="card-heading"><div><span className="section-eyebrow">Quraşdırma qaydası</span><h2>Yeniləmədən əvvəl</h2></div></div>
        <div className="instruction-grid">
          <div><span>01</span><strong>Açıq növbəni tamamlayın</strong><p>Satış davam edirsə, tətbiqi bağlamazdan əvvəl növbəni və açıq hesabları yoxlayın.</p></div>
          <div><span>02</span><strong>Sinxronizasiyanı gözləyin</strong><p>Portalda POS bağlantısının onlayn və son məlumatın yeni olduğunu təsdiqləyin.</p></div>
          <div><span>03</span><strong>Qurulumu başladın</strong><p>Yüklənən faylı açın. Mövcud məlumat qovluğunu əl ilə silməyin.</p></div>
        </div>
      </Card>
    </div>
  );
}

function DownloadsSkeleton() {
  return (
    <div className="page-stack" aria-busy="true">
      <Skeleton width={190} /><Skeleton width="60%" height={42} />
      <Skeleton width="100%" height={340} />
      <div className="two-column-grid"><Skeleton width="100%" height={310} /><Skeleton width="100%" height={310} /></div>
    </div>
  );
}
