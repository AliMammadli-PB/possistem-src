import { useI18n } from '../i18n';
import { SetupDownloadCard } from '../components/SetupDownloadCard';

export function SetupPage() {
  const t = useI18n();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.nav.setup}</h1>
        </div>
      </header>
      <SetupDownloadCard />
    </div>
  );
}
