/**
 * Every name the bundle renders has to exist.
 *
 * Parametrlər went white because `SettingsSectionCtx` was used twice - a
 * `useContext` and a `.Provider` - and declared nowhere. The declaration came
 * from one patch script, the uses from a later one, and when the first script's
 * output was replaced the second kept emitting references to a name that had
 * gone. An undeclared identifier is a ReferenceError at render, and React 18
 * unmounts the whole tree for one: the entire window turned into an empty
 * rectangle, with no message anywhere.
 *
 * Nothing caught it. `node --check` sees valid syntax, the patch scripts each
 * assert their own edits landed, and no test rendered the page. This is the
 * check that would have: a name used as a component, or read as a context,
 * must be bound somewhere in the same file.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

/**
 * Minified names carry `$`, which is an anchor inside a pattern - unescaped,
 * `Row$2` matches nothing and every such component reads as undeclared.
 */
function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Anything that binds `name`: a declaration, a parameter, or a destructure. */
function isBound(rawName: string): boolean {
  const name = escape(rawName);
  return new RegExp(
    [
      `(?:function|const|let|var|class)\\s+${name}\\b`, // declaration
      `:\\s*${name}\\s*[,}=)]`, // destructured under another key: { icon: Icon2 }
      `[({,]\\s*${name}\\s*[,})=]`, // plain parameter or shorthand destructure
    ].join('|'),
  ).test(bundle);
}

/** Capitalised names in the first argument position of a JSX factory call. */
function componentsUsed(source: string): string[] {
  const names = [...source.matchAll(/jsxRuntimeExports\.jsxs?\(\s*([A-Z][A-Za-z0-9_$]*)/g)]
    .map((m) => m[1])
    // `X.Provider` and `X.Consumer` are members of a context, which has to be
    // bound just the same.
    .concat([...source.matchAll(/jsxRuntimeExports\.jsxs?\(\s*([A-Z][A-Za-z0-9_$]*)\.(?:Provider|Consumer)/g)]
      .map((m) => m[1]));
  return [...new Set(names)];
}

describe('the renderer bundle', () => {
  it('binds every component it renders', () => {
    const unbound = componentsUsed(bundle).filter((name) => !isBound(name));
    expect(unbound, `rendered but never declared: ${unbound.join(', ')}`).toEqual([]);
  });

  it('binds every context it reads', () => {
    // The half of the failure that `.Provider` alone would not have caught:
    // a consumer can be in a different function from the provider.
    const contexts = [...new Set(
      [...bundle.matchAll(/reactExports\.useContext\(\s*([A-Z][A-Za-z0-9_$]*)/g)].map((m) => m[1]),
    )];
    expect(contexts.length, 'no contexts found - has the scan broken?').toBeGreaterThan(0);
    const unbound = contexts.filter((name) => !isBound(name));
    expect(unbound, `read but never declared: ${unbound.join(', ')}`).toEqual([]);
  });

  it('keeps the settings rail wired to its own context', () => {
    // The specific pair that broke, named so a future edit that drops one half
    // fails here with the reason rather than as a blank screen on a counter.
    expect(bundle).toContain('const SettingsSectionCtx = reactExports.createContext(null);');
    expect(bundle).toContain('reactExports.useContext(SettingsSectionCtx)');
    expect(bundle).toContain('SettingsSectionCtx.Provider');
  });
});
