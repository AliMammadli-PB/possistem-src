import { useEffect, useState } from 'react';
import { DatabaseBackup, FolderOpen, HardDriveDownload, HardDriveUpload, LoaderCircle } from 'lucide-react';
import type { Lang, SessionUser } from './types';

type BackupStatus = { configured: boolean; directory: string; lastBackupAt: number; retentionDays: number };
type BackupFile = { name: string; path: string; sizeBytes: number; createdAt: number };

/**
 * Parametrlər → Backup. The encrypted `.mposbak` backend lives in electron/main.cjs; this is
 * only its screen. The folder may be a USB flash drive, and "Fayldan yüklə" restores any
 * `.mposbak` file, so a backup taken on another PC comes back with its own password.
 */
export function BackupSettings({ session, lang, notify }: { session: SessionUser; lang: Lang; notify: (s: string) => void }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const api = window.marketSystem?.backup, token = session.sessionToken;
  const [status, setStatus] = useState<BackupStatus | null>(null), [files, setFiles] = useState<BackupFile[]>([]);
  const [password, setPassword] = useState(''), [restorePassword, setRestorePassword] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const refresh = async () => { if (!api) return; setStatus(await api.status()); setFiles(await api.list()); };
  useEffect(() => { void refresh().catch((e) => setError(String(e?.message || e))); }, []);
  const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const work = async (kind: string, fn: () => Promise<void>) => {
    if (busy || !api) return; setBusy(kind); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(clean(e)); } finally { setBusy(''); }
  };
  const configure = () => work('configure', async () => {
    if (password.length < 8) throw new Error(t('Parol minimum 8 simvol olmalıdır', 'Пароль минимум 8 символов', 'Password must be at least 8 characters'));
    if (await api!.configure(token, '', password)) { setPassword(''); notify(t('Backup qovluğu seçildi', 'Папка резервных копий выбрана', 'Backup folder selected')); }
  });
  const create = () => work('create', async () => { await api!.create(token, 'manual'); notify(t('Backup alındı', 'Резервная копия создана', 'Backup created')); });
  const restore = (file: string) => work(file || 'file', async () => {
    if (!confirm(t('Bu backup bərpa edilsin? Hazırkı məlumatlar backup-dakı ilə əvəz olunacaq (köhnə baza silinmir, yanında saxlanılır).', 'Восстановить копию? Текущие данные будут заменены (старая база сохраняется рядом).', 'Restore this backup? Current data is replaced (the old database is kept beside it).'))) return;
    const done = await api!.restore(token, file, restorePassword);
    if (!done) return;
    notify(t('Backup bərpa olundu', 'Копия восстановлена', 'Backup restored'));
    location.reload();
  });
  const when = (ms: number) => (ms ? new Date(ms).toLocaleString() : t('hələ alınmayıb', 'ещё не было', 'never'));
  if (!api) return <section className="panel-card settings-card"><p className="hint">{t('Backup masaüstü Setup versiyasında işləyir', 'Резервные копии работают в установленной версии', 'Backups work in the installed desktop app')}</p></section>;
  return <>
    <section className="panel-card settings-card"><div className="panel-title"><h3>{t('Backup qovluğu', 'Папка копий', 'Backup folder')}</h3><DatabaseBackup/></div>
      <p>{status?.configured ? <><b>{status.directory}</b><br/>{t('Son backup', 'Последняя копия', 'Last backup')}: {when(status.lastBackupAt)}</> : t('Qovluq seçilməyib. Flaş kartı taxın və onu seçin.', 'Папка не выбрана. Вставьте флешку и выберите её.', 'No folder yet. Plug in a USB flash drive and choose it.')}</p>
      <label className="activation-input">{t('Backup parolu (min. 8 simvol)', 'Пароль копий (мин. 8 символов)', 'Backup password (min. 8 characters)')}
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}/></label>
      <div className="button-row">
        <button type="button" disabled={Boolean(busy)} onClick={() => void configure()}>{busy === 'configure' ? <LoaderCircle className="spin"/> : <FolderOpen/>}{t('Qovluq / flaş seç', 'Выбрать папку / флешку', 'Choose folder / flash drive')}</button>
        <button type="button" className="primary-action" disabled={Boolean(busy) || !status?.configured} onClick={() => void create()}>{busy === 'create' ? <LoaderCircle className="spin"/> : <HardDriveDownload/>}{t('İndi backup al', 'Создать копию сейчас', 'Back up now')}</button>
      </div>
      <p className="hint">{t('Backup parolla şifrələnir. Parolu unutsanız backup açılmır. Qovluq qoşulu olanda proqram gündə bir dəfə özü backup alır; 30 gündən köhnələr silinir.', 'Копия шифруется паролем. Без пароля её не открыть. Раз в день копия создаётся сама; старше 30 дней удаляются.', 'Backups are encrypted with the password; without it they cannot be opened. One is taken daily while the folder is connected; older than 30 days are removed.')}</p>
    </section>
    <section className="panel-card settings-card"><div className="panel-title"><h3>{t('Backup yüklə (bərpa)', 'Загрузить копию', 'Load backup')}</h3><HardDriveUpload/></div>
      <label className="activation-input">{t('Başqa kompüterin backup-ı üçün onun parolu (boş qalsa bu kompüterin parolu)', 'Пароль копии с другого ПК (пусто — пароль этого ПК)', 'Password of a backup from another PC (empty uses this PC\'s)')}
        <input type="password" autoComplete="off" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)}/></label>
      <div className="button-row"><button type="button" className="primary-action" disabled={Boolean(busy)} onClick={() => void restore('')}>{busy === 'file' ? <LoaderCircle className="spin"/> : <HardDriveUpload/>}{t('Fayldan yüklə (flaş)', 'Загрузить из файла (флешка)', 'Load from file (flash drive)')}</button></div>
      {files.length > 0 && <ul className="backup-list">{files.map((f) => <li key={f.path}><span><b>{new Date(f.createdAt).toLocaleString()}</b> · {(f.sizeBytes / 1048576).toFixed(1)} MB</span>
        <button type="button" disabled={Boolean(busy)} onClick={() => void restore(f.path)}>{busy === f.path ? <LoaderCircle className="spin"/> : null}{t('Bərpa et', 'Восстановить', 'Restore')}</button></li>)}</ul>}
    </section>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </>;
}
