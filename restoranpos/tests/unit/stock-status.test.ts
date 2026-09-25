/**
 * The four stock states, run out of the shipped bundle.
 *
 * These thresholds decide what an owner orders: "minimumdan aşağı" means order
 * now, "minimuma yaxın" means order with the next delivery. Getting them wrong
 * either buys stock nobody needs or empties the store mid-service, so they are
 * executed here rather than eyeballed.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

/** Lift `stateOf` out of OpsStock and run it on its own. */
function stateOf(row: { qtyMilli: number; minQtyMilli: number }): string {
  const start = bundle.indexOf('  const stateOf = (row) => {');
  expect(start, 'stateOf not found in the bundle').toBeGreaterThan(-1);
  const end = bundle.indexOf('\n  };', start);
  expect(end, 'end of stateOf not found').toBeGreaterThan(start);
  const body = bundle.slice(start + '  const stateOf = '.length, end + 4);
  // eslint-disable-next-line no-new-func -- running our own build output
  return new Function(`return (${body.replace(/;\s*$/, '')})`)()(row).key;
}

describe('stock status', () => {
  it('calls an empty shelf empty, whatever the minimum says', () => {
    expect(stateOf({ qtyMilli: 0, minQtyMilli: 5000 })).toBe('out');
    expect(stateOf({ qtyMilli: 0, minQtyMilli: 0 })).toBe('out');
    // A negative level is a bug elsewhere, but it is still nothing on the shelf.
    expect(stateOf({ qtyMilli: -200, minQtyMilli: 5000 })).toBe('out');
  });

  it('flags below the minimum, where ordering cannot wait', () => {
    expect(stateOf({ qtyMilli: 3200, minQtyMilli: 5000 })).toBe('low');
    expect(stateOf({ qtyMilli: 4999, minQtyMilli: 5000 })).toBe('low');
  });

  it('warns while still above it, so the next delivery can cover it', () => {
    expect(stateOf({ qtyMilli: 5000, minQtyMilli: 5000 })).toBe('near');
    expect(stateOf({ qtyMilli: 6250, minQtyMilli: 5000 })).toBe('near');
  });

  it('is normal once there is real headroom', () => {
    expect(stateOf({ qtyMilli: 6251, minQtyMilli: 5000 })).toBe('ok');
    expect(stateOf({ qtyMilli: 18500, minQtyMilli: 5000 })).toBe('ok');
  });

  it('leaves an untracked item alone instead of nagging', () => {
    // No minimum set means nobody asked to be warned about this one; only an
    // empty shelf is worth saying out loud.
    expect(stateOf({ qtyMilli: 1, minQtyMilli: 0 })).toBe('ok');
    expect(stateOf({ qtyMilli: 999999, minQtyMilli: 0 })).toBe('ok');
  });
});

describe('the stock screen', () => {
  it('reads the figures it shows rather than inventing them', () => {
    expect(bundle).toContain('window.pos.inventory.valuation');
    expect(bundle).toContain('window.pos.inventory.movements');
    expect(bundle).toContain('m.kind !== "waste"');
  });

  it('draws nothing the core cannot answer yet', () => {
    // Category, purchase units, average cost, batches and optimal levels have
    // no schema behind them; drawing them would be a control that lies.
    for (const absent of ['Kateqoriya', 'Alış vahidi', 'Orta alış', 'Partiya', 'Optimal']) {
      expect(bundle, `${absent} is drawn without a backend`).not.toContain(`children: "${absent}"`);
    }
  });

  it('keeps what the operator typed when a save fails', () => {
    expect(bundle).toContain('.then((ok) => { if (ok) setDrawer(null); })');
    expect(bundle).toContain('.then((ok) => { if (ok) setEdit(null); })');
  });
});
