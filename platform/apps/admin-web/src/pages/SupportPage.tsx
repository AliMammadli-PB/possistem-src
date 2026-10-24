import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, apiBlob } from '../lib/api';
import { useI18n } from '../i18n';

type TicketStatus = 'open' | 'claimed' | 'resolved';

type Ticket = {
  id: string;
  customerId: string;
  deviceId: string | null;
  kind: string;
  status: TicketStatus;
  priority: string;
  subject: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  lastMessageAt: string;
  lastCustomerAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
};

type Message = {
  id: string;
  ticketId: string;
  authorKind: string;
  authorUserId: string | null;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
};

/**
 * Till state the POS attached to a support request.
 *
 * Shown with the message so the first reply can already address the problem:
 * version, licence, whether the core is running, how far behind sync is, and the
 * tail of the last core error if there was one.
 */
type FileMeta = { id: string; fileName: string; mimeType: string };

function fileMeta(meta: Record<string, unknown>): FileMeta | null {
  const raw = meta?.attachment;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.fileName !== 'string') return null;
  return { id: row.id, fileName: row.fileName, mimeType: typeof row.mimeType === 'string' ? row.mimeType : '' };
}

function SupportFile({ file }: { file: FileMeta }) {
  const image = file.mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.fileName);
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!image) return;
    let url = '';
    let dead = false;
    void apiBlob(`/support/attachments/${file.id}`)
      .then((blob) => {
        url = URL.createObjectURL(new Blob([blob], { type: file.mimeType || blob.type || 'application/octet-stream' }));
        if (!dead) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, file.mimeType, image]);
  const open = () => {
    void apiBlob(`/support/attachments/${file.id}`).then((blob) => {
      const url = URL.createObjectURL(new Blob([blob], { type: file.mimeType || blob.type || 'application/octet-stream' }));
      window.open(url, '_blank', 'noopener');
    }).catch(() => undefined);
  };
  if (image && src) {
    return (
      <a className="support-file" href={src} target="_blank" rel="noreferrer">
        <img src={src} alt={file.fileName} />
        <span>{file.fileName}</span>
      </a>
    );
  }
  return (
    <button type="button" className="support-file" onClick={open}>
      {file.fileName}
    </button>
  );
}

function DiagnosticsBlock({ meta }: { meta: Record<string, unknown> }) {
  const raw = meta?.diagnostics;
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  if (entries.length === 0) return null;
  return (
    <details className="support-diagnostics">
      <summary>Kassanın vəziyyəti ({entries.length})</summary>
      <dl>
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label === 'lastCoreError' ? 'mono' : undefined}>
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

type TicketListResponse = {
  entries: Ticket[];
  openCount: number;
};

type TicketDetailResponse = {
  ticket: Ticket;
  messages: Message[];
};

function statusBadge(status: TicketStatus, t: ReturnType<typeof useI18n>) {
  const map: Record<TicketStatus, string> = {
    open: t.support.status.open,
    claimed: t.support.status.claimed,
    resolved: t.support.status.resolved,
  };
  return map[status];
}

export function SupportPage() {
  const t = useI18n();
  const { ticketId } = useParams();
  const [list, setList] = useState<TicketListResponse | null>(null);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [filter, setFilter] = useState<TicketStatus | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const lastCustomerMsgRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      setList(await api<TicketListResponse>(`/support/tickets${query}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }, [filter, t.common.error]);

  const loadDetail = useCallback(
    async (id: string, silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await api<TicketDetailResponse>(`/support/tickets/${id}`);
        setDetail(data);

        const lastCustomer = [...data.messages]
          .reverse()
          .find((m) => m.authorKind === 'customer');
        if (
          lastCustomer &&
          lastCustomerMsgRef.current &&
          lastCustomer.id !== lastCustomerMsgRef.current &&
          ticketId === id
        ) {
          // Notifications are routed centrally by SupportDesk during business hours.
        }
        if (lastCustomer) lastCustomerMsgRef.current = lastCustomer.id;
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t.common.error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [ticketId, t.common.error],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!ticketId) {
      setDetail(null);
      setLoading(false);
      return;
    }
    lastCustomerMsgRef.current = null;
    void loadDetail(ticketId);
  }, [ticketId, loadDetail]);

  // The list refreshes whether or not a ticket is open. Gating the whole poll on
  // `ticketId` meant an agent sitting on the Support page with nothing selected
  // never saw a new request arrive.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (ticketId) void loadDetail(ticketId, true);
      void loadList();
    }, 3000);
    return () => window.clearInterval(id);
  }, [ticketId, loadDetail, loadList]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detail?.messages.length]);

  const selected = detail?.ticket;

  async function handleClaim() {
    if (!ticketId) return;
    setClaiming(true);
    setError(null);
    try {
      await api(`/support/tickets/${ticketId}/claim`, { method: 'POST' });
      await loadDetail(ticketId);
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setClaiming(false);
    }
  }

  async function handleSend() {
    if (!ticketId || !message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api(`/support/tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: message.trim() }),
      });
      setMessage('');
      await loadDetail(ticketId, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSending(false);
    }
  }

  /**
   * Sends a file into the ticket — a tool, a driver, a corrected config.
   *
   * Posted as multipart; the server stores it under the attachment id and
   * announces it as a chat message, so the till sees it in the thread and can
   * download and open it there.
   */
  async function handleAttach(file: File) {
    if (!ticketId) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/support/tickets/${ticketId}/attachments`, { method: 'POST', body: form });
      await loadDetail(ticketId, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setUploading(false);
    }
  }

  async function handleResolve() {
    if (!ticketId) return;
    setError(null);
    try {
      await api(`/support/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' }),
      });
      await loadDetail(ticketId);
      await loadList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }

  const openCount = list?.openCount ?? 0;

  return (
    <div className="page support-page">
      <header className="page-head">
        <div>
          <h1>{t.support.title}</h1>
          <p className="muted">{t.support.hint}</p>
        </div>
        {openCount > 0 && (
          <span className="badge badge-warn">{openCount} {t.support.openBadge}</span>
        )}
      </header>

      {error && <div className="banner-error" role="alert">{error}</div>}

      <div className="support-layout">
        <aside className="support-list glass">
          <div className="support-filters">
            {(['open', 'claimed', 'resolved', 'all'] as const).map((status) => (
              <button
                key={status}
                type="button"
                className={filter === status ? 'chip active' : 'chip'}
                onClick={() => setFilter(status)}
              >
                {status === 'all' ? t.support.all : statusBadge(status as TicketStatus, t)}
              </button>
            ))}
          </div>

          <div className="support-tickets">
            {list?.entries.length === 0 && (
              <p className="muted pad">{t.support.empty}</p>
            )}
            {list?.entries.map((entry) => (
              <Link
                key={entry.id}
                to={`/support/${entry.id}`}
                className={
                  ticketId === entry.id ? 'support-ticket active' : 'support-ticket'
                }
              >
                <div className="support-ticket-top">
                  <strong>{entry.customerName ?? '—'}</strong>
                  {entry.priority === 'urgent' && (
                    <span className="badge badge-warn">{t.support.urgent}</span>
                  )}
                </div>
                <div className="muted text-sm">
                  {statusBadge(entry.status, t)} · {entry.customerPhone ?? entry.customerEmail ?? ''}
                </div>
                <div className="muted text-xs">
                  {new Date(entry.lastMessageAt).toLocaleString('az-AZ')}
                </div>
              </Link>
            ))}
          </div>
        </aside>

        <section className="support-chat glass">
          {!ticketId ? (
            <div className="support-empty muted">{t.support.pickTicket}</div>
          ) : loading && !detail ? (
            <div className="support-empty muted">{t.loading}</div>
          ) : !selected ? (
            <div className="support-empty muted">{t.support.notFound}</div>
          ) : (
            <>
              <div className="support-chat-head">
                <div>
                  <h2>{selected.customerName}</h2>
                  <p className="muted text-sm">
                    {selected.customerPhone && <span>{selected.customerPhone} · </span>}
                    {selected.customerEmail}
                  </p>
                </div>
                <div className="support-chat-actions">
                  {selected.status === 'open' && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={claiming}
                      onClick={() => void handleClaim()}
                    >
                      {t.support.accept}
                    </button>
                  )}
                  {selected.status !== 'resolved' && (
                    <button type="button" className="btn ghost" onClick={() => void handleResolve()}>
                      {t.support.resolve}
                    </button>
                  )}
                </div>
              </div>

              <div className="support-messages">
                {detail?.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      msg.authorKind === 'admin'
                        ? 'support-msg admin'
                        : msg.authorKind === 'customer'
                          ? 'support-msg customer'
                          : 'support-msg system'
                    }
                  >
                    <div className="support-msg-meta">
                      {msg.authorKind === 'admin'
                        ? t.support.you
                        : msg.authorKind === 'customer'
                          ? selected.customerName ?? t.support.customer
                          : t.support.system}
                      <span>{new Date(msg.createdAt).toLocaleTimeString('az-AZ')}</span>
                    </div>
                    {(() => {
                      const file = fileMeta(msg.meta);
                      const caption = file && msg.body.trim() === `📎 ${file.fileName}` ? '' : msg.body;
                      return <>
                        {caption ? <div className="support-msg-body">{caption}</div> : null}
                        {file ? <SupportFile file={file} /> : null}
                      </>;
                    })()}
                    <DiagnosticsBlock meta={msg.meta} />
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {selected.status !== 'resolved' ? (
                <>
                <div className="support-attach">
                  <label className="btn ghost">
                    {uploading ? 'Göndərilir…' : '📎 Fayl göndər'}
                    <input
                      type="file"
                      hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void handleAttach(file);
                      }}
                    />
                  </label>
                  <span className="muted">
                    Kassa faylı söhbətdən yükləyib aça bilər (maks. 64 MB).
                  </span>
                </div>
                <div className="support-compose">
                  <textarea
                    rows={3}
                    value={message}
                    placeholder={t.support.placeholder}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={sending || !message.trim()}
                    onClick={() => void handleSend()}
                  >
                    {t.support.send}
                  </button>
                </div>
                </>
              ) : (
                <p className="muted pad">{t.support.resolvedHint}</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
