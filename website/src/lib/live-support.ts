export type LiveChatMessage = {
  id: string;
  author: 'user';
  name: string;
  text: string;
  at: number;
};

export function formatChatTime(at: number, language: string): string {
  const date = new Date(at);
  return date.toLocaleTimeString(language === 'az' ? 'az-Latn-AZ' : language === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function initialOnlineUsers(): number {
  if (typeof window === 'undefined') return 12;
  const stored = sessionStorage.getItem('possistem_live_online');
  if (stored) return Number(stored) || 12;
  const value = randomBetween(8, 18);
  sessionStorage.setItem('possistem_live_online', String(value));
  return value;
}

export function initialMessagesToday(count: number): number {
  if (typeof window === 'undefined') return count;
  const stored = sessionStorage.getItem('possistem_live_msgs_today');
  if (stored) return Math.max(count, Number(stored) || count);
  sessionStorage.setItem('possistem_live_msgs_today', String(count));
  return count;
}
