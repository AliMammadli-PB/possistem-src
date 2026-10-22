import type { SessionUser } from './types';
export async function opsCall<T = any>(session: SessionUser, method: string, payload: Record<string, unknown> = {}, key?: string): Promise<T> {
  if (!window.marketOps) throw new Error('Əməliyyatlar sistemi açıq deyil');
  const result = await window.marketOps.invoke({sessionToken: session.sessionToken, method, payload, idempotencyKey: key, timeoutMs: 30000});
  if (!result.success) throw new Error(result.error?.message || 'Əməliyyat alınmadı');
  return result.data as T;
}
export const operationKey = () => crypto.randomUUID();
export const opsText = (lang: string, az: string, ru: string, en: string) => lang === 'ru' ? ru : lang === 'en' ? en : az;
