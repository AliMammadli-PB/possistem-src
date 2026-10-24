'use client';

import { useSyncExternalStore } from 'react';
import type { DemoMode, DemoScreen } from './data';

/**
 * Which till the demo shows, shared by the hero preview and the fullscreen
 * modal. `session` changes whenever a new till is opened, so the iframe
 * reloads and the visitor starts from a fresh demo database.
 */
export type DemoState = { mode: DemoMode | null; screen: DemoScreen; signedIn: boolean; session: number };

let state: DemoState = { mode: null, screen: 'choose', signedIn: false, session: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<DemoState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

export function useDemoState(): DemoState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
    () => state,
  );
}

export function go(mode: DemoMode | null, screen: DemoScreen = 'pos', signedIn = false) {
  set(mode ? { mode, screen, signedIn, session: state.session + 1 } : { mode: null, screen: 'choose', signedIn: false });
}
