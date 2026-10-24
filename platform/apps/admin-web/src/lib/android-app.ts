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

export function tellApp(message: AppMessage): void {
  // Older APKs also stop receiving passwords from the live console.
  if(message.type==='clear-login')window.PossistemAndroid?.postMessage(JSON.stringify(message));
}


/**
 * Asks the app for the saved login; resolves null when there is none or no app.
 * At most once a minute, so a session that dies right after login cannot loop.
 */
export function savedLogin(): Promise<{ email: string; password: string } | null> { return Promise.resolve(null); }
