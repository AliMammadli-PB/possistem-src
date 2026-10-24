/** Coalesce concurrent identical writes; a second tap shares the first result. */
const writes = new Map<string, Promise<unknown>>();
export function coalesceWrite<T>(key: string, perform: () => Promise<T>): Promise<T> {
  const existing = writes.get(key);
  if (existing) return existing as Promise<T>;
  const pending = perform();
  writes.set(key, pending);
  void pending.finally(() => { if (writes.get(key) === pending) writes.delete(key); }).catch(() => {});
  return pending;
}
