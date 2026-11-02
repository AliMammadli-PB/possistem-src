import { describe, expect, it } from 'vitest';
import { wipeRequestError } from './data-wipe.js';

const ok = { confirmName: 'Dönər Evi', customerName: 'Dönər Evi', deviceCount: 2, inFlight: 0 };

describe('wipeRequestError', () => {
  it('accepts the exact name with tills and nothing in flight', () => {
    expect(wipeRequestError(ok)).toBeNull();
  });
  it('refuses a name that is not exact', () => {
    for (const confirmName of ['', 'dönər evi', 'Dönər Evi ', 'Dönər']) {
      expect(wipeRequestError({ ...ok, confirmName })).toMatch(/adı/);
    }
  });
  it('refuses when there is no restaurant till, or a wipe is already running', () => {
    expect(wipeRequestError({ ...ok, deviceCount: 0 })).toMatch(/kassası/);
    expect(wipeRequestError({ ...ok, inFlight: 1 })).toMatch(/gedir/);
  });
});
