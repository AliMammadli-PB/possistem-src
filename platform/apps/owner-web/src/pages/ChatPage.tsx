import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ApiError,
  botChat,
  botMessage,
  type ChatMessage,
  type ChatQuickAction,
} from '../api';
import { usePolling } from '../hooks/usePolling';
import { Icon } from '../ui/Icon';
import { Alert, Badge, Button, ErrorState, Skeleton } from '../ui/primitives';

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Minimal WhatsApp-style markdown: *bold*, _italic_, `code`, newlines. */
function renderBotBody(body: string) {
  const lines = body.split('\n');
  return lines.map((line, lineIndex) => {
    const parts: Array<string | { type: 'bold' | 'italic' | 'code'; text: string }> = [];
    const regex = /(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line))) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      const token = match[0];
      if (token.startsWith('*')) parts.push({ type: 'bold', text: token.slice(1, -1) });
      else if (token.startsWith('_')) parts.push({ type: 'italic', text: token.slice(1, -1) });
      else parts.push({ type: 'code', text: token.slice(1, -1) });
      last = match.index + token.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    if (parts.length === 0) parts.push('');

    return (
      <span key={lineIndex} className="chat-line">
        {parts.map((part, index) => {
          if (typeof part === 'string') return <span key={index}>{part}</span>;
          if (part.type === 'bold') return <strong key={index}>{part.text}</strong>;
          if (part.type === 'italic') return <em key={index}>{part.text}</em>;
          return <code key={index}>{part.text}</code>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function clientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ChatPage({ standalone = false }: { standalone?: boolean }) {
  const loader = useCallback(() => botChat(), []);
  const state = usePolling(loader, 12_000);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = useMemo(() => {
    const server = state.data?.messages ?? [];
    const known = new Set(server.map((m) => m.id));
    const knownClient = new Set(
      server.map((m) => m.clientMessageId).filter((value): value is string => Boolean(value)),
    );
    const extras = optimistic.filter(
      (m) => !known.has(m.id) && !(m.clientMessageId && knownClient.has(m.clientMessageId)),
    );
    return [...server, ...extras];
  }, [state.data?.messages, optimistic]);

  const quickActions: ChatQuickAction[] = state.data?.quickActions ?? [];
  const diagnostics = state.data?.diagnostics;
  const lastMessage = messages[messages.length - 1];
  const scrollKey = `${messages.length}:${lastMessage?.id ?? ''}:${lastMessage?.body.length ?? 0}:${sending ? 1 : 0}`;

  const scrollToBottom = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Always jump to the last bubble (welcome → … → SON HESABAT / MASALAR).
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = max;
    // iOS sometimes needs a second write after layout.
    scroller.scrollTop = scroller.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    scrollToBottom();
  }, [scrollKey, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
    const scroller = scrollerRef.current;
    const stack = scroller?.querySelector('.chat-scroll-stack') ?? null;
    const frames = [0, 50, 150, 400].map((ms) => window.setTimeout(scrollToBottom, ms));
    let observer: MutationObserver | null = null;
    if (stack) {
      observer = new MutationObserver(() => scrollToBottom());
      observer.observe(stack, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      frames.forEach((id) => window.clearTimeout(id));
      observer?.disconnect();
    };
  }, [scrollKey, scrollToBottom]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setLocalError(null);
    setSending(true);
    const id = clientId();
    const pending: ChatMessage = {
      id: `local-${id}`,
      role: 'user',
      body: trimmed,
      clientMessageId: id,
      meta: { pending: true },
      createdAt: new Date().toISOString(),
    };
    setOptimistic((prev) => [...prev, pending]);
    setDraft('');
    scrollToBottom();

    try {
      const result = await botMessage(trimmed, id);
      setOptimistic((prev) =>
        prev
          .filter((m) => m.clientMessageId !== id)
          .concat(result.botMessages.map((m) => ({ ...m, meta: { ...m.meta, fresh: true } }))),
      );
      await state.reload();
      setOptimistic([]);
      scrollToBottom();
    } catch (error) {
      setOptimistic((prev) => prev.filter((m) => m.clientMessageId !== id));
      setLocalError(
        error instanceof ApiError
          ? error.message
          : 'Mesaj göndərilmədi. İnterneti yoxlayıb yenidən cəhd edin.',
      );
      setDraft(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
      scrollToBottom();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void sendText(draft);
  }

  if (state.loading && !state.data) {
    return (
      <div className={`chat-page${standalone ? ' chat-page-standalone' : ''}`}>
        <div className="chat-shell">
          <Skeleton width="40%" height={28} />
          <Skeleton width="100%" height={360} />
        </div>
      </div>
    );
  }

  if (!state.data && state.error) {
    return (
      <div className={`chat-page${standalone ? ' chat-page-standalone' : ''}`}>
        <ErrorState
          title="Chat yüklənmədi"
          description="Bot panelinə qoşula bilmədik. İnterneti yoxlayıb yenidən cəhd edin."
          action={
            <Button icon="refresh" onClick={() => void state.reload()}>
              Yenidən yoxla
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={`chat-page${standalone ? ' chat-page-standalone' : ''}`}>
      {standalone ? (
        <div className="chat-status-row chat-status-row-standalone">
          <Badge tone={diagnostics?.deviceOnline ? 'success' : 'warning'}>
            {diagnostics?.deviceOnline ? 'Kassa onlayn' : 'Kassa oflayn / gözləyir'}
          </Badge>
          <Badge tone={diagnostics?.liveDatabase ? 'info' : 'danger'}>
            {diagnostics?.liveDatabase ? 'Server bazası hazır' : 'Server bazası yoxdur'}
          </Badge>
        </div>
      ) : (
        <header className="chat-top">
          <div>
            <p className="eyebrow">Restoran botu</p>
            <h1 tabIndex={-1}>Chat</h1>
            <p className="chat-subtitle">
              Telefondan X/Z hesabat, masalar və digər əmrləri WhatsApp kimi yazın — cavablar burada
              ətraflı gəlir.
            </p>
          </div>
          <div className="chat-status-row">
            <Badge tone={diagnostics?.deviceOnline ? 'success' : 'warning'}>
              {diagnostics?.deviceOnline ? 'Kassa onlayn' : 'Kassa oflayn / gözləyir'}
            </Badge>
            <Badge tone={diagnostics?.liveDatabase ? 'info' : 'danger'}>
              {diagnostics?.liveDatabase ? 'Server bazası hazır' : 'Server bazası yoxdur'}
            </Badge>
          </div>
        </header>
      )}

      {!diagnostics?.botEnabled ? (
        <Alert tone="warning" title="Bot söndürülüb">
          {standalone
            ? 'Bot söndürülüb — tam portaldan İnteqrasiyalar bölməsindən aktivləşdirin.'
            : 'İnteqrasiyalar bölməsindən botu aktivləşdirin; əks halda əmrlər qəbul olunmur.'}
        </Alert>
      ) : null}

      {localError ? (
        <Alert tone="danger" title="Göndərmə alınmadı">
          {localError}
        </Alert>
      ) : null}

      <section className="chat-shell" aria-label="Bot söhbəti">
        {/*
          column-reverse keeps the latest bubble glued above chips/composer.
          DOM order stays chronological; visual start is the bottom.
        */}
        <div className="chat-scroll" ref={scrollerRef}>
          <div className="chat-scroll-stack">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chat-bubble chat-bubble-${message.role}${
                  message.meta?.pending ? ' chat-bubble-pending' : ''
                }`}
              >
                <div className="chat-bubble-body">
                  {message.role === 'bot' || message.role === 'system'
                    ? renderBotBody(message.body)
                    : message.body}
                </div>
                <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
              </article>
            ))}
            {sending ? (
              <article className="chat-bubble chat-bubble-bot chat-bubble-typing" aria-live="polite">
                <div className="chat-bubble-body">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              </article>
            ) : null}
            <div className="chat-scroll-end" ref={bottomRef} aria-hidden="true" />
          </div>
        </div>

        <div className="chat-quick" aria-label="Tez əmrlər">
          {quickActions.map((action) => (
            <button
              key={action.text}
              type="button"
              className="chat-chip"
              disabled={sending}
              onClick={() => void sendText(action.text)}
            >
              {action.label}
            </button>
          ))}
        </div>

        <form className="chat-composer" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={sending}
            placeholder="Mesaj yazın… məs: X HESABAT"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendText(draft);
              }
            }}
          />
          <Button
            type="submit"
            variant="primary"
            icon="send"
            disabled={sending || !draft.trim()}
            aria-label="Göndər"
          >
            Göndər
          </Button>
        </form>
      </section>

      {standalone ? null : (
        <p className="chat-footnote">
          <Icon name="info" size={16} /> Z hesabat və qiymət dəyişikliyi təsdiq kodu tələb edir —
          botun göndərdiyi 4 rəqəmi cavab olaraq yazın.
        </p>
      )}
    </div>
  );
}
