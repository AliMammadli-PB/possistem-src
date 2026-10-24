/** Bridge to the POSSİSTEM Admin Android app (absent in a normal browser). */
type AndroidBridge = {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<string>) => void): void;
};

declare global {
  interface Window { PossistemAndroid?: AndroidBridge }
}

export type AppMessage =
  | { type: 'get-login' }
  | { type: 'save-login'; email: string; password: string }
  | { type: 'update-password'; password: string }
  | { type: 'clear-login' };

export const inAndroidApp = () => Boolean(window.PossistemAndroid);

export function tellApp(message: AppMessage) {
  window.PossistemAndroid?.postMessage(JSON.stringify(message));
}

let lastAutoLogin = 0;

/**
 * Asks the app for the saved login; resolves null when there is none or no app.
 * At most once a minute, so a session that dies right after login cannot loop.
 */
export function savedLogin(): Promise<{ email: string; password: string } | null> {
  const app = window.PossistemAndroid;
  if (!app || Date.now() - lastAutoLogin < 60_000) return Promise.resolve(null);
  lastAutoLogin = Date.now();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => done(null), 3000);
    function done(value: { email: string; password: string } | null) {
      window.clearTimeout(timer);
      app!.removeEventListener('message', onMessage);
      resolve(value);
    }
    function onMessage(event: MessageEvent<string>) {
      try {
        const data = JSON.parse(event.data) as { type?: string; email?: string; password?: string };
        if (data.type !== 'saved-login') return;
        done(data.email && data.password ? { email: data.email, password: data.password } : null);
      } catch {
        /* not ours */
      }
    }
    app.addEventListener('message', onMessage);
    tellApp({ type: 'get-login' });
  });
}
