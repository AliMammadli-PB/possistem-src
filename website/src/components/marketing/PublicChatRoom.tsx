'use client';

import Link from 'next/link';
import {
  type ChangeEvent,
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import '@/styles/public-chat-v2.css';
import { useAdminSession } from '@/components/providers/AdminSessionProvider';
import { useCustomerSession } from '@/components/providers/CustomerSessionProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { customerLoginUrl, customerRegisterUrl } from '@/lib/customer-auth-url';
import {
  banChatCustomer,
  createStaffThread,
  createThread,
  deleteStaffMessage,
  deleteStaffThread,
  fetchChatConfig,
  fetchCooldown,
  fetchMentions,
  fetchParticipants,
  fetchProfile,
  fetchThread,
  fetchThreads,
  formatIsoChatDate,
  formatIsoChatTime,
  markAllMentionsRead,
  markMentionRead,
  parseChatBody,
  postReply,
  postStaffReply,
  previewChatBody,
  unbanChatCustomer,
  uploadAvatar,
  uploadChatImage,
  withChatImages,
  type PublicChatMention,
  type PublicChatMessage,
  type PublicChatParticipant,
  type PublicChatThread,
} from '@/lib/public-chat-api';
import { T } from './T';

const TOPIC_CATEGORIES = ['Quraşdırma', 'Lisenziya', 'Yeniləmə', 'Hesab', 'Bildiriş', 'Digər'] as const;

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function avClass(name: string): string {
  const colors = ['av-blue', 'av-orange', 'av-purple', 'av-green', 'av-red'];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash += name.charCodeAt(i);
  return colors[hash % colors.length];
}

function MsgAvatar({ name, url }: { name: string; url?: string | null }) {
  return (
    <div className={`message-avatar ${avClass(name)}`}>
      {url ? <img src={url} alt="" /> : initials(name)}
    </div>
  );
}

function highlightMentions(text: string): ReactNode[] {
  return text.split(/(@[\wÀ-ÿ.\-]+(?:\s[\wÀ-ÿ.\-]+)*)/g).map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function formatCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function ChatEmptyIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 8h10M7 12h6M5.5 19 8 16.5h8A3.5 3.5 0 0 0 19.5 13V7.5A3.5 3.5 0 0 0 16 4H8A3.5 3.5 0 0 0 4.5 7.5V13A3.5 3.5 0 0 0 8 16.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LiveSupportStats() {
  return null;
}

export function PublicChatRoom() {
  const { language, t } = useI18n();
  const { theme } = useTheme();
  const session = useCustomerSession();
  const adminSession = useAdminSession();
  const returnPath = '/destek/chat/';

  const isAdmin = adminSession.authenticated;
  const isCustomer = session.authenticated;
  const isChatUser = isAdmin || isCustomer;
  const sessionLoading = session.loading || adminSession.loading;

  const [threads, setThreads] = useState<PublicChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<PublicChatThread | null>(null);
  const [messages, setMessages] = useState<PublicChatMessage[]>([]);
  const [mentions, setMentions] = useState<PublicChatMention[]>([]);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [chatBanned, setChatBanned] = useState(false);
  const [canCreateTopic, setCanCreateTopic] = useState(true);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownMinutes, setCooldownMinutes] = useState(10);

  const [newTopicMode, setNewTopicMode] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionOptions, setMentionOptions] = useState<PublicChatParticipant[]>([]);
  const [pendingMentions, setPendingMentions] = useState<PublicChatParticipant[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [threadFilter, setThreadFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalCategory, setModalCategory] = useState<string>(TOPIC_CATEGORIES[0]);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [participants, setParticipants] = useState<PublicChatParticipant[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const hasContent = draft.trim().length > 0 || pendingImages.length > 0;
  const customerBanned = chatBanned && !isAdmin;

  const canSend = customerBanned || uploadingImage
    ? false
    : isAdmin
      ? !sending &&
        hasContent &&
        (newTopicMode ? titleDraft.trim().length >= 3 : Boolean(activeThreadId))
      : isCustomer &&
        cooldownSeconds <= 0 &&
        !sending &&
        hasContent &&
        (newTopicMode ? titleDraft.trim().length >= 3 : Boolean(activeThreadId));

  const loadThreads = useCallback(async () => {
    const data = await fetchThreads({ limit: 40 });
    setThreads(data.threads);
    setCooldownMinutes(data.cooldownMinutes);
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    const data = await fetchThread(threadId);
    setActiveThread(data.thread);
    setMessages(data.messages);
    setActiveThreadId(threadId);
    setNewTopicMode(false);
  }, []);

  const refreshMentions = useCallback(async () => {
    if (!isCustomer) {
      setMentions([]);
      return;
    }
    try {
      setMentions(await fetchMentions());
    } catch {
      /* ignore */
    }
  }, [isCustomer]);

  const refreshCooldown = useCallback(async () => {
    if (!isCustomer || isAdmin) {
      setCooldownSeconds(0);
      return;
    }
    try {
      const cd = await fetchCooldown();
      setCooldownMinutes(cd.cooldownMinutes);
      setCooldownSeconds(cd.remainingSeconds);
    } catch {
      /* ignore */
    }
  }, [isCustomer, isAdmin]);

  const refreshParticipants = useCallback(() => {
    void fetchParticipants('').then(setParticipants).catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadThreads();
    void fetchChatConfig().then((c) => setCooldownMinutes(c.cooldownMinutes));
  }, [loadThreads]);

  useEffect(() => {
    refreshParticipants();
  }, [refreshParticipants]);

  useEffect(() => {
    if (session.avatarUrl) {
      setProfileAvatar(session.avatarUrl);
    }
    if (isCustomer && !isAdmin) {
      void fetchProfile().then((p) => {
        if (!session.avatarUrl) setProfileAvatar(p?.avatarUrl ?? null);
        setChatBanned(Boolean(p?.chatBanned));
        setCanCreateTopic(p?.canCreateTopic !== false);
      });
      return;
    }
    setChatBanned(false);
    if (isAdmin) setCanCreateTopic(true);
  }, [isCustomer, isAdmin, session.avatarUrl]);

  useEffect(() => {
    void refreshMentions();
    void refreshCooldown();
  }, [refreshMentions, refreshCooldown, isCustomer, isAdmin]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void loadThreads();
      if (activeThreadId) void loadThread(activeThreadId);
      void refreshMentions();
      void refreshCooldown();
      refreshParticipants();
    }, 12_000);
    return () => window.clearInterval(poll);
  }, [activeThreadId, loadThread, loadThreads, refreshMentions, refreshCooldown, refreshParticipants]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const tmr = window.setInterval(() => setCooldownSeconds((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(tmr);
  }, [cooldownSeconds]);

  useEffect(() => {
    const node = feedRef.current;
    if (!node || messages.length === 0) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, activeThreadId]);

  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 74), 170)}px`;
  }, [draft]);

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionOptions([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchParticipants(mentionQuery).then(setMentionOptions);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [mentionQuery]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTopicModalOpen(false);
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const groupedMessages = useMemo(() => {
    const groups: { date: string; items: PublicChatMessage[] }[] = [];
    for (const message of messages) {
      const date = formatIsoChatDate(message.createdAt, language);
      const last = groups[groups.length - 1];
      if (last?.date === date) last.items.push(message);
      else groups.push({ date, items: [message] });
    }
    return groups;
  }, [messages, language]);

  const sidebarTopics = useMemo(() => {
    const q = threadFilter.trim().toLowerCase();
    return threads
      .filter(
        (thread) =>
          !q ||
          thread.title.toLowerCase().includes(q) ||
          thread.authorName.toLowerCase().includes(q),
      )
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        preview: previewChatBody(thread.lastPreview ?? '') || thread.authorName,
        time: formatIsoChatTime(thread.lastReplyAt, language),
        unread: undefined as number | undefined,
        initials: initials(thread.authorName),
        avatarUrl: thread.avatarUrl,
      }));
  }, [threads, threadFilter, language]);

  const selectThread = (threadId: string) => {
    setSidebarOpen(false);
    void loadThread(threadId);
  };

  const openTopicModal = (prefill = '') => {
    if (!isCustomer && !isAdmin) return;
    if (customerBanned) return;
    if (!isAdmin && !canCreateTopic) {
      setSendError(t('liveChat.topicDailyLimit'));
      return;
    }
    setModalTitle(prefill);
    setModalCategory(TOPIC_CATEGORIES[0]);
    setTopicModalOpen(true);
  };

  const removeThreadLocally = (threadId: string) => {
    setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setActiveThread(null);
      setMessages([]);
    }
  };

  const onDeleteThread = async (threadId: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t('liveChat.confirmDeleteTopic'))) return;
    try {
      await deleteStaffThread(threadId);
      removeThreadLocally(threadId);
    } catch (err) {
      setSendError((err as Error).message || t('liveChat.modError'));
    }
  };

  const onDeleteMessage = async (messageId: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t('liveChat.confirmDeleteMessage'))) return;
    try {
      await deleteStaffMessage(messageId);
      setMessages((prev) => prev.filter((message) => message.id !== messageId));
      void loadThreads();
    } catch (err) {
      setSendError((err as Error).message || t('liveChat.modError'));
    }
  };

  const onBanCustomer = async (customerId: string, name: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t('liveChat.confirmBan').replace('{name}', name))) return;
    try {
      await banChatCustomer(customerId);
      setParticipants((prev) =>
        prev.map((person) =>
          person.customerId === customerId ? { ...person, chatBanned: true } : person,
        ),
      );
      refreshParticipants();
    } catch (err) {
      setSendError((err as Error).message || t('liveChat.modError'));
    }
  };

  const onUnbanCustomer = async (customerId: string, name: string) => {
    if (!isAdmin) return;
    if (!window.confirm(t('liveChat.confirmUnban').replace('{name}', name))) return;
    try {
      await unbanChatCustomer(customerId);
      setParticipants((prev) =>
        prev.map((person) =>
          person.customerId === customerId ? { ...person, chatBanned: false } : person,
        ),
      );
      refreshParticipants();
    } catch (err) {
      setSendError((err as Error).message || t('liveChat.modError'));
    }
  };

  const startNewTopic = () => {
    const title = modalTitle.trim();
    if (title.length < 3) return;
    setTitleDraft(title);
    setNewTopicMode(true);
    setActiveThreadId(null);
    setActiveThread(null);
    setMessages([]);
    setTopicModalOpen(false);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const updateMentionState = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const match = before.match(/@([\wÀ-ÿ.\-]*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
      setMentionIndex(0);
    } else setMentionQuery(null);
  };

  const insertMention = (participant: PublicChatParticipant) => {
    const input = inputRef.current;
    if (!input) return;
    const cursor = input.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const atIndex = before.lastIndexOf('@');
    if (atIndex < 0) return;
    const label = `@${participant.displayName} `;
    setDraft(`${before.slice(0, atIndex)}${label}${after.replace(/^[\wÀ-ÿ.\-]*/, '')}`);
    setMentionQuery(null);
    setPendingMentions((prev) =>
      prev.some((p) => p.customerId === participant.customerId)
        ? prev
        : [...prev, participant],
    );
  };

  const submitMessage = async () => {
    const text = withChatImages(draft, pendingImages);
    if (!text.trim() || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      if (newTopicMode) {
        const title = titleDraft.trim();
        if (title.length < 3) {
          setSendError(t('liveChat.titleRequired'));
          return;
        }
        const result = isAdmin
          ? await createStaffThread(title, text)
          : await createThread(title, text, pendingMentions, session.csrfToken);
        setThreads((prev) => [result.thread, ...prev.filter((x) => x.id !== result.thread.id)]);
        setActiveThreadId(result.thread.id);
        setActiveThread(result.thread);
        setMessages([result.message]);
        setNewTopicMode(false);
        setTitleDraft('');
        if (!isAdmin) setCanCreateTopic(false);
      } else if (activeThreadId) {
        if (isAdmin) {
          const message = await postStaffReply(activeThreadId, text);
          setMessages((prev) => [...prev, message]);
        } else {
          const message = await postReply(activeThreadId, text, pendingMentions, session.csrfToken);
          setMessages((prev) => [...prev, message]);
        }
        void loadThreads();
      } else {
        setSendError(t('liveChat.pickTopic'));
        return;
      }
      setDraft('');
      setPendingImages([]);
      setPendingMentions([]);
      if (!isAdmin) setCooldownSeconds(cooldownMinutes * 60);
    } catch (err) {
      const error = err as Error & { status?: number; remainingSeconds?: number; code?: string };
      if (error.status === 429 && error.remainingSeconds) {
        setCooldownSeconds(error.remainingSeconds);
        setSendError(t('liveChat.cooldownActive'));
      } else if (error.code === 'TOPIC_DAILY_LIMIT') {
        setCanCreateTopic(false);
        setSendError(t('liveChat.topicDailyLimit'));
      } else if (error.code === 'CHAT_BANNED' || (error.status === 403 && error.message === 'Chat banned')) {
        setChatBanned(true);
        setSendError(t('liveChat.bannedNotice'));
      } else setSendError(error.message || t('liveChat.sendError'));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitMessage();
  };

  const onAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !isCustomer || isAdmin) return;
    setUploadingAvatar(true);
    setSendError(null);
    try {
      const url = await uploadAvatar(file, session.csrfToken);
      setProfileAvatar(url);
      session.setAvatarUrl(url);
    } catch {
      setSendError(t('liveChat.avatarError'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || (!isCustomer && !isAdmin)) return;
    if (!isAdmin && !session.csrfToken) {
      setSendError(t('liveChat.imageError'));
      return;
    }
    if (pendingImages.length >= 4) {
      setSendError(t('liveChat.imageLimit'));
      return;
    }
    setUploadingImage(true);
    setSendError(null);
    try {
      const url = await uploadChatImage(file, session.csrfToken, isAdmin);
      setPendingImages((prev) => [...prev, url]);
    } catch {
      setSendError(t('liveChat.imageError'));
    } finally {
      setUploadingImage(false);
    }
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionOptions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionOptions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionOptions[mentionIndex]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const chatTitle = newTopicMode
    ? t('liveChat.newTopic')
    : activeThread?.title ?? t('liveChat.roomTitle');

  const showPickTopic =
    isChatUser && !newTopicMode && !activeThreadId && messages.length === 0;
  const showThreadEmpty =
    isChatUser && !newTopicMode && Boolean(activeThreadId) && messages.length === 0;
  /* Show gate for guests even while session resolves — avoids blank center pane. */
  const showLoginGate = !isChatUser && !activeThreadId;
  const hasMessages = groupedMessages.length > 0;

  const accountName = session.name || adminSession.email || t('liveChat.account.fallback');
  const composerLocked = customerBanned
    ? true
    : newTopicMode
      ? !isCustomer && !isAdmin
      : !isChatUser || !activeThreadId;
  const canAttach =
    (isCustomer || isAdmin) &&
    !composerLocked &&
    !uploadingImage &&
    pendingImages.length < 4 &&
    (isAdmin || Boolean(session.csrfToken));
  const allowNewTopic = isChatUser && !customerBanned && (isAdmin || canCreateTopic);

  return (
    <div className="pch-root" data-theme={theme === 'light' ? 'light' : 'dark'}>
      <div className="app">
        <div className="chat-app">
          <aside className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label={t('liveChat.topicsTitle')}>
            <div className="sidebar-head">
              <div className="sidebar-title">
                <span className="live-dot" />
                <T k="liveChat.liveSupport" />
              </div>
              {allowNewTopic ? (
                <button className="new-topic" type="button" onClick={() => openTopicModal()}>
                  + <T k="liveChat.newTopic" />
                </button>
              ) : isCustomer && !isAdmin && !canCreateTopic && !customerBanned ? (
                <div className="topic-limit-hint">{t('liveChat.topicDailyHint')}</div>
              ) : null}
              <div className="search">
                <label className="sr-only" htmlFor="topicSearch">
                  {t('liveChat.searchTopics')}
                </label>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  id="topicSearch"
                  ref={searchRef}
                  type="search"
                  value={threadFilter}
                  onChange={(e) => setThreadFilter(e.target.value)}
                  placeholder={t('liveChat.searchTopics')}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="sidebar-content">
              <div className="sidebar-label">
                <T k="liveChat.conversations" />
              </div>
              {newTopicMode ? (
                <button type="button" className="channel active">
                  <span className="channel-icon">+</span>
                  <span className="channel-info">
                    <span className="channel-name">{titleDraft || t('liveChat.newTopic')}</span>
                    <span className="channel-description">{t('liveChat.newTopicHint')}</span>
                  </span>
                </button>
              ) : null}
              {sidebarTopics.map((topic) => (
                <div
                  key={topic.id}
                  className={`channel-wrap${activeThreadId === topic.id && !newTopicMode ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    className={`channel${activeThreadId === topic.id && !newTopicMode ? ' active' : ''}`}
                    onClick={() => selectThread(topic.id)}
                  >
                    <span className="channel-icon">#</span>
                    <span className="channel-info">
                      <span className="channel-name">{topic.title}</span>
                      <span className="channel-description">{topic.preview}</span>
                    </span>
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="mod-btn"
                      aria-label={t('liveChat.deleteTopic')}
                      title={t('liveChat.deleteTopic')}
                      onClick={() => void onDeleteThread(topic.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {sidebarTopics.length === 0 && !newTopicMode ? (
                <div className="channel-empty">{t('liveChat.noTopicsYet')}</div>
              ) : null}
            </div>

            <div className="sidebar-bottom">
              {isCustomer && !isAdmin ? (
                <>
                  <button
                    className={`account-card account-card-edit${uploadingAvatar ? ' is-busy' : ''}`}
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    aria-label={t('liveChat.changeAvatar')}
                    title={t('liveChat.changeAvatar')}
                  >
                    <span className="avatar">
                      {profileAvatar ? <img src={profileAvatar} alt="" /> : initials(accountName)}
                      <span className="avatar-camera" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path
                            d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.4l.8-1.3A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.3.7L16.1 6h1.4A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
                            stroke="currentColor"
                            strokeWidth="1.7"
                          />
                          <circle cx="12" cy="12.2" r="3.1" stroke="currentColor" strokeWidth="1.7" />
                        </svg>
                      </span>
                    </span>
                    <span>
                      <span className="account-name">{accountName}</span>
                      <span className="account-status">
                        {uploadingAvatar ? t('liveChat.avatarUploading') : t('liveChat.changeAvatarHint')}
                      </span>
                    </span>
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={onAvatarUpload}
                  />
                </>
              ) : isChatUser ? (
                <div className="account-card">
                  <div className="avatar">
                    {profileAvatar ? <img src={profileAvatar} alt="" /> : initials(accountName)}
                  </div>
                  <div>
                    <div className="account-name">{accountName}</div>
                    <div className="account-status">{t('liveChat.accountActive')}</div>
                  </div>
                </div>
              ) : (
                <div className="account-card account-card-guest">
                  <div className="account-status">{t('liveChat.loginPrompt')}</div>
                  <Link className="account-login-link" href={customerLoginUrl(returnPath)}>
                    <T k="index.text.015" />
                  </Link>
                </div>
              )}
            </div>
          </aside>

          <section className="chat-main" aria-label={t('liveChat.roomTitle')}>
            <div
              className={`mobile-overlay${sidebarOpen ? ' show' : ''}`}
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />

            <div className="chat-header">
              <button
                className="mobile-sidebar-btn"
                type="button"
                aria-label={t('liveChat.topicsTitle')}
                onClick={() => setSidebarOpen(true)}
              >
                ☰
              </button>
              <div className="room-symbol">#</div>
              <div className="room-info">
                <div className="room-name">{chatTitle}</div>
                <div className="room-sub">
                  <span className="room-online" />
                  {newTopicMode ? t('liveChat.newTopicHint') : t('liveChat.roomSubtitle')}
                </div>
              </div>
              <div className="chat-header-actions">
                {isAdmin && activeThreadId && !newTopicMode ? (
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label={t('liveChat.deleteTopic')}
                    title={t('liveChat.deleteTopic')}
                    onClick={() => void onDeleteThread(activeThreadId)}
                  >
                    ×
                  </button>
                ) : null}
                <Link className="icon-btn" href="/destek" aria-label={t('liveChat.back')} title={t('liveChat.back')}>
                  ←
                </Link>
              </div>
            </div>

            <div className="chat-notice">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7v6M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <T k="liveChat.notice" />
            </div>

            <div
              className={`messages${showLoginGate || showPickTopic || showThreadEmpty ? ' is-empty' : ''}`}
              ref={feedRef}
              aria-live="polite"
            >
              {showLoginGate ? (
                <div className="empty-state">
                  <div className="empty-icon" aria-hidden="true">
                    <ChatEmptyIcon />
                  </div>
                  <h3>
                    <T k="liveChat.loginPrompt" />
                  </h3>
                  <p>
                    <T k="liveChat.loginDetail" />
                  </p>
                  <div className="empty-actions">
                    <Link className="primary-btn" href={customerLoginUrl(returnPath)}>
                      <T k="index.text.015" />
                    </Link>
                    <Link className="secondary-btn" href={customerRegisterUrl(returnPath)}>
                      <T k="index.text.143" />
                    </Link>
                  </div>
                </div>
              ) : null}

              {showPickTopic ? (
                <div className="empty-state">
                  <div className="empty-icon" aria-hidden="true">
                    <ChatEmptyIcon />
                  </div>
                  <h3>
                    <T k="liveChat.pickTopic" />
                  </h3>
                  {allowNewTopic ? (
                    <div className="empty-actions">
                      <button className="primary-btn" type="button" onClick={() => openTopicModal()}>
                        + <T k="liveChat.newTopic" />
                      </button>
                    </div>
                  ) : isCustomer && !canCreateTopic ? (
                    <p>{t('liveChat.topicDailyHint')}</p>
                  ) : null}
                </div>
              ) : null}

              {showThreadEmpty ? (
                <div className="empty-state">
                  <div className="empty-icon" aria-hidden="true">
                    <ChatEmptyIcon />
                  </div>
                  <h3>
                    <T k="liveChat.empty" />
                  </h3>
                </div>
              ) : null}

              {hasMessages
                ? groupedMessages.map((group) => (
                    <div key={group.date}>
                      <div className="date-divider">{group.date}</div>
                      {group.items.map((message) => {
                        const parsed = parseChatBody(message.body);
                        return (
                          <article key={message.id} className="message">
                            <MsgAvatar name={message.authorName} url={message.avatarUrl} />
                            <div className="message-body">
                              <div className="message-top">
                                <span className="message-name">{message.authorName}</span>
                                {message.isStaff ? (
                                  <span className="staff">
                                    <T k="liveChat.staffBadge" />
                                  </span>
                                ) : null}
                                <span className="message-time">
                                  {formatIsoChatTime(message.createdAt, language)}
                                </span>
                              </div>
                              {parsed.text ? (
                                <div className="message-text">{highlightMentions(parsed.text)}</div>
                              ) : null}
                              {parsed.images.length > 0 ? (
                                <div className="message-images">
                                  {parsed.images.map((src) => (
                                    <img key={src} src={src} alt="" />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {isAdmin ? (
                              <div className="msg-mod">
                                <button
                                  type="button"
                                  onClick={() => void onDeleteMessage(message.id)}
                                >
                                  {t('liveChat.deleteMessage')}
                                </button>
                                {message.customerId && !message.isStaff ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void onBanCustomer(message.customerId as string, message.authorName)
                                    }
                                  >
                                    {t('liveChat.banCustomer')}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ))
                : null}
            </div>

            <div className="composer-area">
              {!isChatUser && !sessionLoading && !showLoginGate ? (
                <div className="composer-lock-banner">
                  <p>
                    <T k="liveChat.loginPrompt" />
                  </p>
                  <Link className="primary-btn" href={customerLoginUrl(returnPath)}>
                    <T k="index.text.015" />
                  </Link>
                </div>
              ) : null}
              {newTopicMode ? (
                <div className="composer-help" style={{ marginBottom: 8 }}>
                  <span>
                    <T k="liveChat.newTopic" />: <strong>{titleDraft}</strong>
                  </span>
                </div>
              ) : null}
              <form className={`composer${uploadingImage ? ' is-uploading' : ''}`} onSubmit={onSubmit}>
                {pendingImages.length > 0 || uploadingImage ? (
                  <div className="image-previews">
                    {pendingImages.map((src) => (
                      <figure key={src}>
                        <img src={src} alt="" />
                        <button
                          type="button"
                          aria-label={t('liveChat.close')}
                          onClick={() => setPendingImages((prev) => prev.filter((x) => x !== src))}
                        >
                          ×
                        </button>
                      </figure>
                    ))}
                    {uploadingImage ? (
                      <figure className="is-loading" aria-live="polite">
                        <span className="img-spinner" aria-hidden="true" />
                        <span className="sr-only">{t('liveChat.imageUploading')}</span>
                      </figure>
                    ) : null}
                  </div>
                ) : null}
                <label className="sr-only" htmlFor="messageInput">
                  {t('liveChat.send')}
                </label>
                <textarea
                  id="messageInput"
                  ref={inputRef}
                  maxLength={2000}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setSendError(null);
                    updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  }}
                  onKeyDown={onDraftKeyDown}
                  placeholder={
                    uploadingImage
                      ? t('liveChat.imageUploading')
                      : newTopicMode
                        ? t('liveChat.newTopicBodyPlaceholder')
                        : isAdmin
                          ? t('liveChat.inputStaffReply')
                          : isCustomer
                            ? t('liveChat.inputPublicMention')
                            : t('liveChat.inputLocked')
                  }
                  disabled={composerLocked || uploadingImage}
                />
                {mentionQuery !== null && mentionOptions.length > 0 ? (
                  <ul className="mention-menu">
                    {mentionOptions.map((option, index) => (
                      <li key={option.customerId}>
                        <button
                          type="button"
                          className={index === mentionIndex ? 'is-active' : ''}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            insertMention(option);
                          }}
                        >
                          @{option.displayName}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="composer-bottom">
                  <button
                    className={`composer-tool${uploadingImage ? ' is-busy' : ''}`}
                    type="button"
                    aria-label={uploadingImage ? t('liveChat.imageUploading') : t('liveChat.attach')}
                    disabled={!canAttach || uploadingImage}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M8 12.5 13.5 7a3 3 0 0 1 4.2 4.3l-7.4 7.3a5 5 0 0 1-7.1-7L11 3.8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={onImageUpload}
                  />
                  <button
                    className="composer-tool"
                    type="button"
                    aria-label="@"
                    disabled={composerLocked}
                    onClick={() => {
                      setDraft((prev) => `${prev}@`);
                      inputRef.current?.focus();
                    }}
                  >
                    @
                  </button>
                  <span className="char-count">
                    {draft.length} / 2000
                  </span>
                  <button className="send-btn" type="submit" disabled={!canSend} aria-label={t('liveChat.send')}>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="m4 4 17 8-17 8 3-8-3-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <path d="M7 12h14" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </button>
                </div>
              </form>
              <div className="composer-help">
                <span>
                  {sendError ||
                    (uploadingImage
                      ? t('liveChat.imageUploading')
                      : customerBanned
                        ? t('liveChat.bannedNotice')
                        : !isAdmin && cooldownSeconds > 0
                          ? t('liveChat.cooldownWait').replace('{time}', formatCooldown(cooldownSeconds))
                          : t('liveChat.composerHint'))}
                </span>
                <span>
                  <T k="liveChat.publicTopicLabel" />
                </span>
              </div>
            </div>
          </section>

          <aside className="members" aria-label={t('liveChat.members')}>
            <div className="members-head">
              <div className="members-title">
                <T k="liveChat.members" />
              </div>
              <div className="members-count">{participants.length}</div>
            </div>
            <div className="members-list">
              <div className="member-section">
                <div className="member-label">
                  <T k="liveChat.teamSection" />
                </div>
                <div className="member">
                  <div className="member-avatar-wrap">
                    <div className="member-avatar av-orange">PS</div>
                    <span className="status-dot" />
                  </div>
                  <div>
                    <div className="member-name">possistem</div>
                    <div className="member-role">
                      <T k="liveChat.staffBadge" />
                    </div>
                  </div>
                </div>
              </div>
              {participants.length > 0 ? (
                <div className="member-section">
                  <div className="member-label">
                    <T k="liveChat.onlineCustomers" />
                  </div>
                  {participants.slice(0, 12).map((person) => (
                    <div className="member" key={person.customerId}>
                      <div className="member-avatar-wrap">
                        <div className={`member-avatar ${avClass(person.displayName)}`}>
                          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person.displayName)}
                        </div>
                        <span className={`status-dot${person.chatBanned ? ' is-banned' : ''}`} />
                      </div>
                      <div className="member-meta">
                        <div className="member-name">{person.displayName}</div>
                        {person.chatBanned ? (
                          <div className="member-role">
                            <T k="liveChat.bannedBadge" />
                          </div>
                        ) : null}
                      </div>
                      {isAdmin ? (
                        person.chatBanned ? (
                          <button
                            type="button"
                            className="mod-btn member-mod"
                            onClick={() => void onUnbanCustomer(person.customerId, person.displayName)}
                          >
                            {t('liveChat.unbanCustomer')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mod-btn member-mod"
                            onClick={() => void onBanCustomer(person.customerId, person.displayName)}
                          >
                            {t('liveChat.banCustomer')}
                          </button>
                        )
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {mentions.length > 0 ? (
                <div className="member-section">
                  <div className="member-label">
                    <T k="liveChat.mentionsTitle" />
                  </div>
                  {mentions.map((mention) => (
                    <article key={mention.id} className="notif-item">
                      <header>
                        <strong>{mention.authorName}</strong>
                        <time dateTime={mention.createdAt}>{formatIsoChatTime(mention.createdAt, language)}</time>
                      </header>
                      <p>{previewChatBody(mention.body)}</p>
                      <button
                        type="button"
                        onClick={() =>
                          void markMentionRead(mention.id, session.csrfToken).then(() =>
                            setMentions((m) => m.filter((x) => x.id !== mention.id)),
                          )
                        }
                      >
                        <T k="liveChat.mentionsRead" />
                      </button>
                    </article>
                  ))}
                  {isCustomer ? (
                    <button
                      type="button"
                      className="secondary-btn"
                      style={{ marginTop: 8, width: '100%' }}
                      onClick={() => void markAllMentionsRead(session.csrfToken).then(() => setMentions([]))}
                    >
                      <T k="liveChat.mentionsClear" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rules-card">
              <div className="rules-title">
                <T k="liveChat.rulesTitle" />
              </div>
              <div className="rule">
                <span className="rule-dot" />
                <span>
                  <T k="liveChat.rules.2" />
                </span>
              </div>
              <div className="rule">
                <span className="rule-dot" />
                <span>
                  <T k="liveChat.rules.1" />
                </span>
              </div>
              <div className="rule">
                <span className="rule-dot" />
                <span>
                  <T k="liveChat.rules.4" />
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div
        className={`modal-backdrop${topicModalOpen ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
        onClick={(e) => {
          if (e.target === e.currentTarget) setTopicModalOpen(false);
        }}
      >
        <div className="modal">
          <div className="modal-top">
            <div>
              <h3 id="modalTitle">
                <T k="liveChat.modalTitle" />
              </h3>
              <p>
                <T k="liveChat.modalHint" />
              </p>
            </div>
            <button
              className="icon-btn modal-close"
              type="button"
              aria-label={t('liveChat.close')}
              onClick={() => setTopicModalOpen(false)}
            >
              ×
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startNewTopic();
            }}
          >
            <div className="field">
              <label htmlFor="topicTitle">
                <T k="liveChat.topicTitleLabel" />
              </label>
              <input
                id="topicTitle"
                required
                maxLength={80}
                value={modalTitle}
                onChange={(e) => setModalTitle(e.target.value)}
                placeholder={t('liveChat.topicTitlePlaceholder')}
              />
            </div>
            <div className="field">
              <label htmlFor="topicCategory">
                <T k="liveChat.topicCategoryLabel" />
              </label>
              <select id="topicCategory" value={modalCategory} onChange={(e) => setModalCategory(e.target.value)}>
                {TOPIC_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" type="button" onClick={() => setTopicModalOpen(false)}>
                <T k="liveChat.modalCancel" />
              </button>
              <button className="primary-btn" type="submit">
                <T k="liveChat.modalSubmit" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
