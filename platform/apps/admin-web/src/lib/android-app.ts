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

/** Passwords never leave the page: the app may only be told to forget a stored login. */
export function tellApp(message: AppMessage) {
  if (message.type === 'clear-login') window.PossistemAndroid?.postMessage(JSON.stringify(message));
}

/** Auto-login with a stored password is disabled; the admin signs in each time. */
export function savedLogin(): Promise<{ email: string; password: string } | null> {
  return Promise.resolve(null);
}
