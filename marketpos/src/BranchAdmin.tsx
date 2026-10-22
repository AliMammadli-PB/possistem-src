import { useState } from 'react';
import type { Lang } from './types';

/**
 * POSSISTEM's user (1.5.34): rename or remove the filial this PC belongs to,
 * right from Parametrlər. Removing takes its PCs out of it first; a PC without
 * a filial asks for one at POSSISTEM's next sign-in.
 */
export function BranchAdmin({ lang, token, branchId, name, onChanged }: { lang: Lang; token: string; branchId: string; name: string; onChanged: () => void }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (operation: Record<string, unknown>, done: string) => {
    setBusy(true); setMessage('');
    try { await window.marketSystem!.branches.manage(token, operation); setMessage(done); onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="panel-card settings-card">
    <div className="panel-title"><h3>{t('Filial (POSSISTEM)', 'Филиал (POSSISTEM)', 'Branch (POSSISTEM)')}</h3></div>
    <form className="branch-admin" onSubmit={(event) => { event.preventDefault(); if (draft.trim().length >= 2 && draft.trim() !== name) void run({ action: 'rename', branchId, name: draft.trim() }, t('Ad dəyişdi', 'Название изменено', 'Renamed')); }}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} minLength={2} maxLength={120} disabled={busy} aria-label={t('Filialın adı', 'Название филиала', 'Branch name')} />
      <button type="submit" disabled={busy || draft.trim().length < 2 || draft.trim() === name}>{t('Adı dəyiş', 'Переименовать', 'Rename')}</button>
      <button type="button" className="danger" disabled={busy} onClick={() => { if (confirm(t(`"${name}" filialı silinsin? Kassaları filialdan çıxarılacaq, satış tarixçəsi qalır.`, `Удалить филиал «${name}»? Кассы будут отвязаны, история продаж сохранится.`, `Delete branch "${name}"? Its tills are detached; sales history stays.`))) void run({ action: 'delete', branchId, detachTills: true }, t('Filial silindi', 'Филиал удалён', 'Branch deleted')); }}>{t('Filialı sil', 'Удалить филиал', 'Delete branch')}</button>
    </form>
    {message && <p className="label-hint" role="status">{message}</p>}
  </section>;
}
