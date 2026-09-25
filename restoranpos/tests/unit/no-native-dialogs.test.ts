import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const BUNDLE = path.resolve(__dirname, '../../index-DAmHwBc4.js');

/**
 * `window.confirm` / `alert` / `prompt` open *native* dialogs.
 *
 * Electron gives focus to that dialog's own window and does not reliably hand
 * it back. This app runs frameless and fullscreen, so once focus is lost there
 * is no title bar left to click to get it back: the till keeps rendering
 * normally while silently ignoring every tap on an input, permanently. It
 * surfaced after deleting several dishes in a row — one native dialog per
 * delete — and then the next input touched, anywhere in the app, was dead.
 *
 * `useConfirm` / `usePrompt` in components/dialogs.tsx draw the same thing in
 * React, inside the window that already has focus.
 */
describe('the renderer never opens a native dialog', () => {
  it('has no window.confirm, window.alert or window.prompt call', () => {
    const offenders: string[] = [];

    readFileSync(BUNDLE, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // The replacement hooks name these in their own documentation.
        const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '');
        if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(code)) {
          offenders.push(`index-DAmHwBc4.js:${index + 1}`);
        }
      });

    expect(offenders).toEqual([]);
  });
});
