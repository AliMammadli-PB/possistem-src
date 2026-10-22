import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from './types';
import { tr } from './i18n';

/**
 * Technical support chat (1.5.49). The till writes to possistem support through the owner account;
 * the same ticket rings the support APK and is answered from the console.
 */
export type SupportMessage = { id: string; ticketId: string; authorKind: 'customer' | 'admin' | 'system' | string; body: string; createdAt: string };
export type SupportTicket = { id: string; status: 'open' | 'claimed' | 'resolved' | string; claimedAt: string | null };

const COPY = {
  az: { title: 'Texniki dəstək', placeholder: 'Probleminizi yazın…', send: 'Göndər', close: 'Bağla', support: 'Dəstək', you: 'Siz',
    empty: 'Probleminizi yazın — mesaj dərhal dəstək komandasına çatır.', waiting: 'Sorğunuz göndərildi. Dəstək əməkdaşı gözlənilir…',
    claimed: 'Dəstək əməkdaşı qoşuldu — yazışa bilərsiniz.', resolved: 'Sorğu bağlanıb. Yeni mesaj yeni sorğu açacaq.', phone: 'Telefon: 051 333 35 55', offline: 'Bağlantı yoxdur. Yenidən yoxlanılır…' },
  ru: { title: 'Техподдержка', placeholder: 'Опишите проблему…', send: 'Отправить', close: 'Закрыть', support: 'Поддержка', you: 'Вы',
    empty: 'Опишите проблему — сообщение сразу получит команда поддержки.', waiting: 'Запрос отправлен. Ожидаем специалиста…',
    claimed: 'Специалист подключился — можно переписываться.', resolved: 'Запрос закрыт. Новое сообщение откроет новый запрос.', phone: 'Телефон: 051 333 35 55', offline: 'Нет связи. Повторяем…' },
  en: { title: 'Technical support', placeholder: 'Describe the problem…', send: 'Send', close: 'Close', support: 'Support', you: 'You',
    empty: 'Describe the problem — the support team gets it right away.', waiting: 'Request sent. Waiting for a support agent…',
    claimed: 'A support agent joined — you can chat now.', resolved: 'Request closed. A new message opens a new request.', phone: 'Phone: 051 333 35 55', offline: 'No connection. Retrying…' },
};

const SEEN_KEY = 'marketpos.support.seenAdmin';
const api = () => window.marketSystem?.support;
const listOf = (value: unknown): SupportMessage[] => Array.isArray(value) ? value as SupportMessage[] : Array.isArray((value as { messages?: unknown })?.messages) ? (value as { messages: SupportMessage[] }).messages : [];
const lastAdminAt = (messages: SupportMessage[]) => messages.filter((m) => m.authorKind === 'admin').map((m) => m.createdAt).sort().at(-1) ?? '';

function chime() {
  try {
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.5); osc.onended = () => void ctx.close();
  } catch { /* audio unavailable */ }
}

export function SupportChat({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const c = COPY[lang] ?? COPY.az;
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const active = await api()!.active();
    setTicket(active.ticket); setMessages(listOf(active.messages)); setError('');
    try { localStorage.setItem(SEEN_KEY, lastAdminAt(listOf(active.messages))); } catch { /* storage blocked */ }
  }, []);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  // New messages every 4 s while the chat is open; the ticket status (claimed / resolved) every 12 s.
  useEffect(() => {
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      if (!ticket || tick % 3 === 0) { load().catch(() => setError(c.offline)); return; }
      const after = messages.at(-1)?.createdAt;
      api()!.messages(ticket.id, after).then((value) => {
        const fresh = listOf(value).filter((m) => !messages.some((old) => old.id === m.id));
        if (fresh.length) {
          setMessages((old) => [...old, ...fresh]);
          if (fresh.some((m) => m.authorKind === 'admin')) chime();
          try { localStorage.setItem(SEEN_KEY, lastAdminAt([...messages, ...fresh])); } catch { /* storage blocked */ }
        }
        setError('');
      }).catch(() => setError(c.offline));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [ticket, messages, load, c.offline]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages.length]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError('');
    try { await api()!.send(ticket?.id ?? null, body); setDraft(''); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const status = !ticket ? c.empty : ticket.status === 'claimed' ? c.claimed : ticket.status === 'resolved' ? c.resolved : c.waiting;
  return (
    <div className="mp-chat-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="mp-chat" role="dialog" aria-modal="true" aria-label={c.title}>
        <header className="mp-chat-head">
          <div><strong>{c.title}</strong><span className={`mp-chat-status${ticket?.status === 'claimed' ? ' is-live' : ''}`}>{status}</span></div>
          <button type="button" className="mp-chat-close" onClick={onClose} aria-label={c.close}>×</button>
        </header>
        <div className="mp-chat-list" ref={list}>
          {messages.map((m) => (
            <div key={m.id} className={`mp-chat-msg is-${m.authorKind === 'customer' ? 'me' : m.authorKind === 'admin' ? 'agent' : 'system'}`}>
              {m.authorKind !== 'system' && <small>{m.authorKind === 'customer' ? c.you : c.support} · {new Date(m.createdAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}</small>}
              <p>{m.body}</p>
            </div>
          ))}
        </div>
        {error && <p className="mp-chat-error" role="alert">{error}</p>}
        <form className="mp-chat-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={c.placeholder} rows={3} maxLength={4000} disabled={busy} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button type="submit" disabled={busy || !draft.trim()}>{busy ? '…' : c.send}</button>
        </form>
        <p className="mp-chat-phone">{c.phone}</p>
      </section>
    </div>
  );
}

/** "Texniki dəstək" button with an unread badge; checks for support replies every 30 s while closed. */
export function SupportButton({ lang, variant }: { lang: Lang; variant: 'gate' | 'top' }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (open || !api()) return;
    const check = () => api()!.active().then((active) => {
      const latest = lastAdminAt(listOf(active.messages));
      let seen = ''; try { seen = localStorage.getItem(SEEN_KEY) ?? ''; } catch { /* storage blocked */ }
      if (latest && latest > seen) { setUnread((was) => { if (!was) chime(); return true; }); }
    }).catch(() => undefined);
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [open]);
  if (!api()) return null;
  return (
    <>
      <button type="button" className={`mp-support-btn mp-support-btn--${variant}`} onClick={() => { setOpen(true); setUnread(false); }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        <span>{tr(lang, 'techSupport')}</span>
        {unread && <i className="mp-support-dot" aria-label="new" />}
      </button>
      {open && <SupportChat lang={lang} onClose={() => setOpen(false)} />}
    </>
  );
}
