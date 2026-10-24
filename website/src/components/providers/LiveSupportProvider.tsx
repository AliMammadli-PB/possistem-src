'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { initialMessagesToday, initialOnlineUsers, randomBetween, type LiveChatMessage } from '@/lib/live-support';

type LiveSupportContextValue = {
  messages: LiveChatMessage[];
  onlineUsers: number;
  messagesToday: number;
  pushUserMessage: (text: string, name: string) => void;
};

const LiveSupportContext = createContext<LiveSupportContextValue | null>(null);

const PUBLIC_CHAT_KEY = 'possistem_public_chat_messages';

function loadPublicUserMessages(): LiveChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PUBLIC_CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LiveChatMessage[];
    return Array.isArray(parsed) ? parsed.filter((item) => item.author === 'user') : [];
  } catch {
    return [];
  }
}

function savePublicUserMessages(messages: LiveChatMessage[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PUBLIC_CHAT_KEY, JSON.stringify(messages.slice(-80)));
}

export function LiveSupportProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<LiveChatMessage[]>(() => loadPublicUserMessages());
  const [onlineUsers, setOnlineUsers] = useState(initialOnlineUsers);
  const [messagesToday, setMessagesToday] = useState(() => initialMessagesToday(loadPublicUserMessages().length));

  const pushUserMessage = useCallback((text: string, name: string) => {
    const message: LiveChatMessage = {
      id: `user-${Date.now()}`,
      author: 'user',
      name,
      text,
      at: Date.now(),
    };
    setMessages((prev) => {
      const next = [...prev, message];
      savePublicUserMessages(next);
      return next;
    });
    setMessagesToday((value) => {
      const next = value + 1;
      sessionStorage.setItem('possistem_live_msgs_today', String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const onlineTimer = window.setInterval(() => {
      if (Math.random() > 0.6) return;
      setOnlineUsers((value) => {
        const delta = randomBetween(-1, 1);
        const next = Math.max(6, Math.min(24, value + delta));
        sessionStorage.setItem('possistem_live_online', String(next));
        return next;
      });
    }, randomBetween(28000, 42000));

    return () => window.clearInterval(onlineTimer);
  }, []);

  const value = useMemo(
    () => ({ messages, onlineUsers, messagesToday, pushUserMessage }),
    [messages, onlineUsers, messagesToday, pushUserMessage],
  );

  return <LiveSupportContext.Provider value={value}>{children}</LiveSupportContext.Provider>;
}

export function useLiveSupport() {
  const ctx = useContext(LiveSupportContext);
  if (!ctx) throw new Error('useLiveSupport must be used within LiveSupportProvider');
  return ctx;
}
