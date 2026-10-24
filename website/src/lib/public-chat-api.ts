export type PublicChatThread = {
  id: string;
  customerId: string | null;
  authorName: string;
  title: string;
  replyCount: number;
  lastReplyAt: string;
  createdAt: string;
  avatarUrl: string | null;
  lastPreview?: string | null;
};

export type PublicChatMessage = {
  id: string;
  threadId: string | null;
  customerId: string | null;
  authorName: string;
  body: string;
  isStaff: boolean;
  avatarUrl: string | null;
  createdAt: string;
};

export type PublicChatMention = {
  id: string;
  messageId: string;
  threadId: string | null;
  threadTitle: string | null;
  body: string;
  authorName: string;
  authorCustomerId: string;
  createdAt: string;
};

export type PublicChatParticipant = {
  customerId: string;
  displayName: string;
  avatarUrl: string | null;
  chatBanned?: boolean;
};

export type PublicChatCooldown = {
  cooldownMinutes: number;
  canSend: boolean;
  remainingSeconds: number;
  nextSendAt: string | null;
};

export type PublicChatProfile = {
  customerId: string;
  name: string;
  avatarUrl: string | null;
  chatBanned?: boolean;
  canCreateTopic?: boolean;
  nextTopicAt?: string | null;
};

import { adminAuthHeaders } from '@/lib/admin-session';

const BASE = '/pos/api/public/chat';

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & {
    error?: string;
    remainingSeconds?: number;
    code?: string;
    nextAt?: string | null;
  };
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`) as Error & {
      status?: number;
      remainingSeconds?: number;
      code?: string;
      nextAt?: string | null;
    };
    err.status = res.status;
    err.remainingSeconds = data.remainingSeconds;
    err.code = data.code;
    err.nextAt = data.nextAt;
    throw err;
  }
  return data;
}

export async function fetchChatConfig(): Promise<{ cooldownMinutes: number }> {
  const res = await fetch(`${BASE}/config`, { credentials: 'include' });
  return parseJson(res);
}

export async function fetchThreads(params?: {
  before?: string;
  limit?: number;
}): Promise<{ threads: PublicChatThread[]; hasMore: boolean; cooldownMinutes: number }> {
  const search = new URLSearchParams();
  if (params?.before) search.set('before', params.before);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  const res = await fetch(`${BASE}/threads${qs ? `?${qs}` : ''}`, { credentials: 'include' });
  return parseJson(res);
}

export async function fetchThread(
  threadId: string,
): Promise<{ thread: PublicChatThread; messages: PublicChatMessage[] }> {
  const res = await fetch(`${BASE}/threads/${threadId}`, { credentials: 'include' });
  return parseJson(res);
}

export async function fetchParticipants(q: string): Promise<PublicChatParticipant[]> {
  const search = new URLSearchParams();
  if (q.trim()) search.set('q', q.trim());
  const res = await fetch(`${BASE}/participants?${search}`, { credentials: 'include' });
  const data = await parseJson<{ participants: PublicChatParticipant[] }>(res);
  return data.participants;
}

export async function fetchMentions(): Promise<PublicChatMention[]> {
  const res = await fetch(`${BASE}/mentions`, { credentials: 'include' });
  const data = await parseJson<{ mentions: PublicChatMention[] }>(res);
  return data.mentions;
}

export async function fetchCooldown(): Promise<PublicChatCooldown> {
  const res = await fetch(`${BASE}/cooldown`, { credentials: 'include' });
  return parseJson(res);
}

export async function fetchProfile(): Promise<PublicChatProfile | null> {
  const res = await fetch(`${BASE}/profile`, { credentials: 'include' });
  if (res.status === 401) return null;
  return parseJson(res);
}

export async function createThread(
  title: string,
  body: string,
  mentions: PublicChatParticipant[],
  csrfToken: string | null,
): Promise<{ thread: PublicChatThread; message: PublicChatMessage }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/threads`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      title,
      body,
      mentions: mentions.map((p) => ({ customerId: p.customerId, displayName: p.displayName })),
    }),
  });
  return parseJson(res);
}

export async function postStaffReply(threadId: string, body: string): Promise<PublicChatMessage> {
  const res = await fetch(`${BASE}/staff/threads/${threadId}/replies`, {
    method: 'POST',
    credentials: 'include',
    headers: adminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body }),
  });
  const data = await parseJson<{ message: PublicChatMessage }>(res);
  return data.message;
}

export async function createStaffThread(
  title: string,
  body: string,
): Promise<{ thread: PublicChatThread; message: PublicChatMessage }> {
  const res = await fetch(`${BASE}/staff/threads`, {
    method: 'POST',
    credentials: 'include',
    headers: adminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title, body }),
  });
  return parseJson(res);
}

export async function deleteStaffThread(threadId: string): Promise<void> {
  const res = await fetch(`${BASE}/staff/threads/${threadId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: adminAuthHeaders(),
  });
  await parseJson(res);
}

export async function deleteStaffMessage(messageId: string): Promise<void> {
  const res = await fetch(`${BASE}/staff/messages/${messageId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: adminAuthHeaders(),
  });
  await parseJson(res);
}

export async function banChatCustomer(customerId: string): Promise<void> {
  const res = await fetch(`${BASE}/staff/customers/${customerId}/ban`, {
    method: 'POST',
    credentials: 'include',
    headers: adminAuthHeaders(),
  });
  await parseJson(res);
}

export async function unbanChatCustomer(customerId: string): Promise<void> {
  const res = await fetch(`${BASE}/staff/customers/${customerId}/ban`, {
    method: 'DELETE',
    credentials: 'include',
    headers: adminAuthHeaders(),
  });
  await parseJson(res);
}

export async function postReply(
  threadId: string,
  body: string,
  mentions: PublicChatParticipant[],
  csrfToken: string | null,
): Promise<PublicChatMessage> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/threads/${threadId}/replies`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      body,
      mentions: mentions.map((p) => ({ customerId: p.customerId, displayName: p.displayName })),
    }),
  });
  const data = await parseJson<{ message: PublicChatMessage }>(res);
  return data.message;
}

export function parseChatBody(body: string): { text: string; images: string[] } {
  const images: string[] = [];
  const text = body
    .replace(/\[\[img:(\/pos\/api\/public\/chat\/uploads\/[0-9a-f-]{36}\.webp)\]\]/gi, (_, url: string) => {
      images.push(url);
      return '';
    })
    .trim();
  return { text, images };
}

export function withChatImages(text: string, urls: string[]): string {
  const tokens = urls.map((url) => `[[img:${url}]]`).join('\n');
  return [text.trim(), tokens].filter(Boolean).join('\n');
}

export function previewChatBody(body: string): string {
  const { text, images } = parseChatBody(body);
  if (text) return text;
  return images.length ? '📷' : '';
}

export async function uploadChatImage(
  file: File,
  csrfToken: string | null,
  asStaff = false,
): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const url = asStaff ? `${BASE}/staff/uploads` : `${BASE}/uploads`;
  if (asStaff) {
    Object.assign(headers, adminAuthHeaders());
  } else if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  const send = () => {
    const form = new FormData();
    form.append('file', file);
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    });
  };
  let res = await send();
  if (!res.ok && res.status >= 500) {
    res = await send();
  }
  const data = await parseJson<{ url: string }>(res);
  return data.url;
}

export async function uploadAvatar(file: File, csrfToken: string | null): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/avatar`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: form,
  });
  const data = await parseJson<{ avatarUrl: string }>(res);
  return `${data.avatarUrl}?v=${Date.now()}`;
}

export async function removeAvatar(csrfToken: string | null): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/avatar`, {
    method: 'DELETE',
    credentials: 'include',
    headers,
  });
  await parseJson(res);
}

export async function markMentionRead(id: string, csrfToken: string | null): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/mentions/${id}/read`, {
    method: 'PATCH',
    credentials: 'include',
    headers,
  });
  await parseJson(res);
}

export async function markAllMentionsRead(csrfToken: string | null): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(`${BASE}/mentions/read-all`, {
    method: 'PATCH',
    credentials: 'include',
    headers,
  });
  await parseJson(res);
}

export function formatIsoChatTime(iso: string, language: string): string {
  return new Date(iso).toLocaleTimeString(
    language === 'az' ? 'az-Latn-AZ' : language === 'ru' ? 'ru-RU' : 'en-US',
    { hour: '2-digit', minute: '2-digit' },
  );
}

export function formatIsoChatDate(iso: string, language: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return language === 'az' ? 'Bu gün' : 'Today';
  return d.toLocaleDateString(
    language === 'az' ? 'az-Latn-AZ' : language === 'ru' ? 'ru-RU' : 'en-US',
    { day: 'numeric', month: 'short' },
  );
}
