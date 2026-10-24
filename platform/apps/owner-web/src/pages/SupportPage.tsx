import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  deleteSupportUpload,
  formatBytes,
  supportAttach,
  supportReply,
  supportRequest,
  supportThread,
  supportUploads,
  uploadSupportFile,
  type SupportMessage,
  type SupportTicketInfo,
  type SupportUpload,
} from '../api';
import { FileUpload } from '../ui/forms';
import { Icon } from '../ui/Icon';
import { PageHeader } from '../ui/navigation';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../ui/primitives';
import { ConfirmDialog, useToast } from '../ui/overlays';

const articles = [
  {
    id: 'setup',
    title: 'POS serverdə görünmür',
    category: 'Quraşdırma',
    answer: 'POS tətbiqini açıq saxlayın, kompüter internetini və aktivasiya açarını yoxlayın. Quraşdırma mərkəzində bağlantını yenidən yoxlayın.',
  },
  {
    id: 'license',
    title: 'Aktiv lisenziya yoxdur',
    category: 'Lisenziya',
    answer: 'Müştəri hesabı lisenziyanı avtomatik yaratmır. Satış komandası restoran və kassa sayına uyğun lisenziya və aktivasiya açarı təqdim edir.',
  },
  {
    id: 'update',
    title: 'Yeniləmə necə quraşdırılır?',
    category: 'Yeniləmə',
    answer: 'Açıq növbəni tamamlayın, sinxronizasiyanı gözləyin və Yükləmələr səhifəsindən son versiyanı başladın. Məlumat qovluğunu əl ilə silməyin.',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp QR qoşulmur',
    category: 'İnteqrasiya',
    answer: 'Telefonda WhatsApp → Bağlı cihazlar bölməsini açın. Köhnə QR vaxtı bitibsə, portalda yeni QR yaradın. Telefon və server internetini yoxlayın.',
  },
  {
    id: 'notifications',
    title: 'Telefon bildirişi gəlmir',
    category: 'Bildiriş',
    answer: 'Brauzer icazəsini yoxlayın. iPhone-da portalı Safari-dən Əsas ekrana əlavə edib həmin ikonla açmaq və iOS 16.4+ istifadə etmək tələb olunur.',
  },
  {
    id: 'password',
    title: 'Hesaba daxil ola bilmirəm',
    category: 'Hesab',
    answer: 'Giriş səhifəsində “Şifrəni unutmusunuz?” keçidindən istifadə edin. Hesab mövcuddursa, 30 dəqiqəlik şifrə yeniləmə məktubu göndərilir.',
  },
];

export default function SupportPage() {
  const [params] = useSearchParams();
  const initialTopic = params.get('topic') || '';
  const [query, setQuery] = useState(initialTopic === 'license' ? 'lisenziya' : initialTopic === 'setup' ? 'serverdə görünmür' : '');
  const [uploads, setUploads] = useState<SupportUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SupportUpload | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { show } = useToast();

  const loadUploads = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await supportUploads();
      setUploads(response.uploads);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Fayl siyahısı yüklənmədi.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadUploads(); }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('az-AZ');
    if (!normalized) return articles;
    return articles.filter((article) =>
      `${article.title} ${article.category} ${article.answer}`.toLocaleLowerCase('az-AZ').includes(normalized),
    );
  }, [query]);

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Fayl 10 MB limitini keçir.');
      return;
    }
    if (!/\.(log|txt|json|zip)$/i.test(file.name)) {
      setUploadError('Yalnız LOG, TXT, JSON və ZIP faylları qəbul edilir.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setUploadProgress(0);
    setUploadError('');
    try {
      const result = await uploadSupportFile(file, setUploadProgress, controller.signal);
      setUploads((current) => [result, ...current]);
      show({ tone: 'success', title: 'Diaqnostika faylı göndərildi', message: 'Dəstək komandası faylı təhlükəsiz hesab sahəsində görə bilər.' });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        show({ tone: 'info', title: 'Yükləmə ləğv edildi' });
      } else {
        setUploadError(cause instanceof Error ? cause.message : 'Fayl yüklənmədi.');
      }
    } finally {
      abortRef.current = null;
      setUploading(false);
    }
  };

  // ---- Live support chat -------------------------------------------------
  // Polls rather than holding a socket: the API has no realtime transport, and
  // at support volumes a 5 s poll is cheaper than adding one.
  const [thread, setThread] = useState<SupportMessage[]>([]);
  const [ticket, setTicket] = useState<SupportTicketInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const data = await supportThread();
        if (!alive) return;
        setTicket(data.ticket);
        setThread(data.messages);
        setChatError('');
      } catch (cause) {
        if (alive) setChatError(cause instanceof Error ? cause.message : 'Söhbət yüklənmədi.');
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setChatError('');
    try {
      // No open ticket yet -> /request opens one. Afterwards messages append to
      // it, so the customer keeps one continuous conversation with support.
      if (ticket) {
        const message = await supportReply(ticket.id, text);
        setThread((current) => [...current, message]);
      } else {
        const created = await supportRequest(text);
        setTicket(created.ticket);
        setThread((current) => [...current, created.message]);
      }
      setDraft('');
      show({ tone: 'success', title: 'Mesaj göndərildi', message: 'Dəstək komandası cavab verəcək.' });
    } catch (cause) {
      setChatError(cause instanceof Error ? cause.message : 'Mesaj göndərilmədi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Kömək mərkəzi"
        title="Dəstək"
        description="Quraşdırma, hesab və inteqrasiya problemləri üçün aydın həll yolları."
        actions={
          <a className="button button-primary button-md" href="https://wa.me/994513333555?text=Salam%2C%20possistem%20m%C3%BC%C5%9Ft%C9%99ri%20d%C9%99st%C9%99yin%C9%99%20ehtiyac%C4%B1m%20var." target="_blank" rel="noreferrer">
            <WhatsappIcon /><span>WhatsApp dəstəyi · 051 333 35 55</span>
          </a>
        }
      />

      <Card className="support-chat-card">
        <div className="card-heading">
          <div>
            <span className="section-eyebrow">Canlı dəstək</span>
            <h2>Dəstək komandası ilə yazışma</h2>
          </div>
          {ticket ? (
            <Badge tone={ticket.status === 'resolved' ? 'neutral' : 'success'}>
              {ticket.status === 'resolved'
                ? 'Bağlanıb'
                : ticket.claimedAt
                  ? 'Operator qoşulub'
                  : 'Gözləyir'}
            </Badge>
          ) : null}
        </div>
        <p className="muted-copy">
          Buradan yazdığınız mesaj dərhal dəstək komandasına düşür. Cavab gəldikdə
          bildiriş alacaqsınız.
        </p>

        <div className="support-chat-thread" aria-live="polite">
          {thread.length ? (
            thread.map((message) => (
              <div key={message.id} data-author={message.authorKind} className="support-chat-message">
                <span className="support-chat-author">
                  {message.authorKind === 'customer'
                    ? 'Siz'
                    : message.authorKind === 'admin'
                      ? 'Dəstək'
                      : 'Sistem'}
                </span>
                {message.meta?.attachment?.id && message.body.trim() === `📎 ${message.meta.attachment.fileName}` ? null : <p>{message.body}</p>}
                {message.meta?.attachment?.id ? (
                  <a className="support-chat-file" href={`/pos/api/customer/support/attachments/${message.meta.attachment.id}`} target="_blank" rel="noreferrer">
                    {(message.meta.attachment.mimeType ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(message.meta.attachment.fileName ?? '')
                      ? <img src={`/pos/api/customer/support/attachments/${message.meta.attachment.id}`} alt={message.meta.attachment.fileName ?? 'Şəkil'} />
                      : (message.meta.attachment.fileName ?? 'Faylı aç')}
                  </a>
                ) : null}
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString('az-AZ')}
                </time>
              </div>
            ))
          ) : (
            <EmptyState
              title="Hələ mesaj yoxdur"
              description="Probleminizi yazın — dəstək komandası ilə söhbət burada başlayacaq."
            />
          )}
        </div>

        {chatError ? <p className="form-error">{chatError}</p> : null}

        <div className="support-chat-compose">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line — what people expect
              // from a chat box.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Problemi qısa yazın: nə baş verir, hansı kassada?"
            rows={3}
            aria-label="Dəstək mesajı"
          />
          <label className="button button-secondary button-md">
            Fayl
            <input
              type="file"
              hidden
              accept="image/*,.pdf,.zip,.txt,.log,.json"
              disabled={sending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void (async () => {
                  setSending(true);
                  setChatError('');
                  try {
                    const current = ticket ?? (await supportRequest('Fayl göndərildi')).ticket;
                    setTicket(current);
                    const sent = await supportAttach(current.id, file);
                    if (sent.message) setThread((list) => [...list, sent.message!]);
                    else {
                      const data = await supportThread();
                      setThread(data.messages);
                    }
                  } catch (cause) {
                    setChatError(cause instanceof Error ? cause.message : 'Fayl göndərilmədi.');
                  } finally {
                    setSending(false);
                  }
                })();
              }}
            />
          </label>
          <Button
            variant="primary"
            size="md"
            onClick={() => void sendMessage()}
            disabled={sending || !draft.trim()}
          >
            {sending ? 'Göndərilir...' : 'Göndər'}
          </Button>
        </div>
      </Card>

      <Card className="support-search-card">
        <div className="support-search">
          <Icon name="search" size={22} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Məsələn: POS serverdə görünmür" aria-label="Dəstək mövzularında axtarış" />
          {query ? <Button variant="ghost" size="sm" onClick={() => setQuery('')}>Təmizlə</Button> : null}
        </div>
        <div className="support-topics" aria-label="Populyar mövzular">
          {['Quraşdırma', 'Lisenziya', 'Yeniləmə', 'WhatsApp', 'Bildiriş'].map((topic) => <button key={topic} type="button" onClick={() => setQuery(topic)}>{topic}</button>)}
        </div>
      </Card>

      <section>
        <div className="section-heading-row"><div><span className="section-eyebrow">Bilik bazası</span><h2>Tez həll olunan məsələlər</h2></div><span>{filtered.length} nəticə</span></div>
        {filtered.length ? (
          <div className="support-articles">
            {filtered.map((article) => (
              <details key={article.id} open={initialTopic === article.id}>
                <summary><span><Badge tone="neutral">{article.category}</Badge><strong>{article.title}</strong></span><Icon name="chevron-down" size={19} /></summary>
                <div><p>{article.answer}</p>{article.id === 'setup' ? <a href={`${import.meta.env.BASE_URL}setup`}>Quraşdırma mərkəzini açın <Icon name="arrow-right" size={16} /></a> : null}</div>
              </details>
            ))}
          </div>
        ) : <EmptyState title="Uyğun məqalə tapılmadı" description="Axtarışı sadələşdirin və ya WhatsApp dəstəyinə yazın." />}
      </section>

      <div className="support-grid">
        <Card>
          <div className="card-heading"><div><span className="section-eyebrow">Təhlükəsiz fayl ötürməsi</span><h2>Diaqnostika göndərin</h2></div><Icon name="upload" size={24} /></div>
          <p className="muted-copy">Dəstək komandası tələb etdikdə POS log və diaqnostika faylını göndərin. Fayllar web qovluğundan kənarda saxlanılır və 30 gün sonra silinmək üçün işarələnir.</p>
          <FileUpload
            onUpload={(file) => void upload(file)}
            busy={uploading}
            progress={uploadProgress}
            error={uploadError}
            onCancel={() => abortRef.current?.abort()}
          />
        </Card>

        <Card>
          <div className="card-heading"><div><span className="section-eyebrow">Göndərilənlər</span><h2>Diaqnostika faylları</h2></div></div>
          {loading ? <><Skeleton width="100%" height={62} /><Skeleton width="100%" height={62} /></> :
            loadError ? <ErrorState compact title="Fayllar yüklənmədi" description={loadError} action={<Button size="sm" icon="refresh" onClick={() => void loadUploads()}>Yenidən yoxla</Button>} /> :
            uploads.length ? (
              <div className="upload-list">
                {uploads.map((uploadItem) => (
                  <div key={uploadItem.id}>
                    <span><Icon name="file" size={19} /></span>
                    <div><strong>{uploadItem.name}</strong><small>{formatBytes(uploadItem.sizeBytes)} · {new Date(uploadItem.createdAt).toLocaleString('az-AZ')}</small></div>
                    <Badge tone={uploadItem.status === 'received' ? 'info' : 'neutral'}>{uploadItem.status === 'received' ? 'Qəbul edilib' : uploadItem.status}</Badge>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleteTarget(uploadItem)}>Sil</Button>
                  </div>
                ))}
              </div>
            ) : <EmptyState compact title="Fayl göndərilməyib" description="Dəstək tələb etməyibsə, diaqnostika göndərməyə ehtiyac yoxdur." />}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Diaqnostika faylını silmək?"
        description={deleteTarget ? `${deleteTarget.name} serverdən silinəcək.` : ''}
        confirmLabel="Faylı sil"
        danger
        busy={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          setDeleting(true);
          void deleteSupportUpload(deleteTarget.id)
            .then(() => {
              setUploads((current) => current.filter((item) => item.id !== deleteTarget.id));
              setDeleteTarget(null);
              show({ tone: 'success', title: 'Diaqnostika faylı silindi' });
            })
            .catch((cause) => show({ tone: 'danger', title: 'Fayl silinmədi', message: cause instanceof Error ? cause.message : undefined }))
            .finally(() => setDeleting(false));
        }}
      />
    </div>
  );
}

function WhatsappIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26A9.89 9.89 0 0 1 12.06 2a9.8 9.8 0 0 1 7 2.9 9.83 9.83 0 0 1 2.9 7c0 5.45-4.44 9.88-9.91 9.88M20.46 3.49A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.23-6.16-3.48-8.42" />
    </svg>
  );
}
