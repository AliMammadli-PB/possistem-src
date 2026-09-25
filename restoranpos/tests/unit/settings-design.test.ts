/**
 * The settings panel's design invariants.
 *
 * Parametrlər is styled by an appended CSS layer rather than by markup, so
 * these are the things that would silently rot: a later patch changing a class
 * string, a Tailwind utility winning on specificity, or type and tap targets
 * drifting back under the floor they were raised from.
 *
 * The layer under test is the one that ships. An earlier `.ps-settings-stack`
 * layer was replaced by the exact operator mockup, and its three generators now
 * detect that and skip - so this file follows the shipped chrome
 * (`POS_SETTINGS_EXACT_v1` plus the corrections appended after it) rather than
 * the layer that was retired.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = fs.readFileSync(path.join(ROOT, 'possistem-system.css'), 'utf8');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

const start = css.indexOf('/* POS_SETTINGS_EXACT_v1 */');
// Everything from the exact layer onward: the corrections that follow it are
// part of the shipped result and must be read together with it.
const layer = start === -1 ? '' : css.slice(start);

describe('settings design layer', () => {
  it('is present and self-contained', () => {
    expect(start, 'the shipped settings layer is missing').toBeGreaterThan(-1);
    expect(layer.length).toBeGreaterThan(1000);
    expect(layer.split('{').length).toBe(layer.split('}').length);
  });

  it('is scoped to the settings panel', () => {
    // Service screens keep their own language on purpose. Every top-level
    // selector the exact layer opens with is anchored to the settings page;
    // the later layers in this slice own other screens and are not asserted.
    const exactOnly = layer.slice(0, layer.indexOf('/* POS_SETTINGS_SPACE_v1 */'));
    const stray = [...new Set([...exactOnly.matchAll(/^\.([a-z-]+)/gm)].map((m) => m[1]))]
      .filter((selector) => !selector.startsWith('ps-settings'));
    expect(stray, `these escaped the settings scope: ${stray.join(', ')}`).toEqual([]);
  });

  it('keeps its controls reachable by thumb', () => {
    // --ps-tap is 44px and was declared but unused before any of this work.
    expect(css).toContain('--ps-tap: 2.75rem');
    const tapTargets = [...layer.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(tapTargets.length, 'nothing declares a height floor').toBeGreaterThan(0);
    expect(Math.max(...tapTargets)).toBeGreaterThanOrEqual(40);
  });

  it('keeps every size at or above the 12px floor', () => {
    // Read at arm's length on a counter, not at 100% on a desk. The mockup
    // brought four declarations in at 10-11px; the legibility layer lifts them.
    const sizes = [...layer.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length, 'no type declared in the layer').toBeGreaterThan(0);

    // The four the mockup set too small are overridden later in the cascade, so
    // the check is on what each selector finally resolves to.
    const resolved = new Map<string, number>();
    for (const rule of layer.matchAll(/(\.ps-settings-page[^{]*)\{([^}]*)\}/g)) {
      const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(rule[2]);
      if (size) resolved.set(rule[1].trim(), Number(size[1]));
    }
    const tooSmall = [...resolved].filter(([, size]) => size < 12);
    expect(tooSmall.map(([selector]) => selector), 'under the 12px floor').toEqual([]);
  });

  it('gives the danger zone its warning framing', () => {
    expect(layer).toContain('[data-section="danger"]');
    expect(bundle).toContain('"data-section": settingsSection');
  });

  it('respects reduced motion', () => {
    expect(layer).toContain('prefers-reduced-motion');
  });
});
