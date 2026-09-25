/**
 * The till a person sees depends on the job they do.
 *
 * `/tables` used to be pinned `show: true`, so a storekeeper signing in with
 * their PIN landed on a floor plan they have no permission to touch, while
 * stock - their actual work - sat three clicks away behind the admin hub.
 *
 * These read the shipped bundle rather than a source module, because the
 * renderer here IS the bundle: there is no other copy to test.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

/**
 * Lift `homeRouteForRole` out of the bundle and run it.
 *
 * Nothing else in it is needed, so the function is evaluated on its own - a
 * regex over the text would only prove the words are there, not that a
 * storekeeper actually ends up in the store.
 */
function homeRouteForRole(session: unknown): string {
  const start = bundle.indexOf('function homeRouteForRole(session) {');
  expect(start, 'homeRouteForRole not found in the bundle').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = bundle.indexOf('{', start); i < bundle.length; i += 1) {
    if (bundle[i] === '{') depth += 1;
    else if (bundle[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func -- evaluating our own build output
        return new Function(`${bundle.slice(start, i + 1)}; return homeRouteForRole;`)()(session);
      }
    }
  }
  throw new Error('homeRouteForRole body not found');
}

describe('where a shift starts', () => {
  it('sends a storekeeper to the store, not the floor', () => {
    expect(
      homeRouteForRole({
        role: 'storekeeper',
        permissions: ['inventory.view', 'inventory.count', 'suppliers.receive'],
      }),
    ).toBe('/operations?tab=stock');
  });

  it('sends a waiter to the floor', () => {
    expect(homeRouteForRole({ role: 'waiter', permissions: ['order.view', 'tables.status'] }))
      .toBe('/tables');
  });

  it('sends the kitchen to the kitchen screen', () => {
    expect(homeRouteForRole({ role: 'kitchen', permissions: ['kds.view', 'inventory.view'] }))
      .toBe('/kds');
  });

  it('leaves an administrator on the floor, where they were', () => {
    // An admin holds every permission, so the first rule wins - this is the
    // check that the reordering did not quietly move them somewhere new.
    expect(
      homeRouteForRole({
        role: 'administrator',
        permissions: ['order.view', 'inventory.view', 'reports.view', 'settings.manage'],
      }),
    ).toBe('/tables');
  });

  it('follows permissions, not the name, for a role someone invented', () => {
    // Roles are data: an operator can create one on the roles screen or have
    // one pushed from the website. A name nobody hardcoded must still land.
    expect(homeRouteForRole({ role: 'Anbarçı 2', permissions: ['inventory.view'] }))
      .toBe('/operations?tab=stock');
  });

  it('falls back to the floor when a session carries no permissions', () => {
    expect(homeRouteForRole({ role: 'waiter', permissions: [] })).toBe('/tables');
    expect(homeRouteForRole('storekeeper')).toBe('/operations?tab=stock');
  });
});

describe('the sidebar', () => {
  it('no longer pins the floor plan open for everyone', () => {
    expect(bundle).not.toContain('{ to: "/tables", label: t.nav.tables, icon: Table2, show: true },\n    { to: "/kds"');
    expect(bundle).toContain('hasPermission("order.view") || hasPermission("order.create") || hasPermission("tables.status")');
  });

  it('offers the operations panels to the people whose job they are', () => {
    for (const [label, perm] of [
      ['Anbar', 'inventory.view'],
      ['Təchizat', 'suppliers.view'],
      ['Çatdırılma', 'delivery.view'],
    ]) {
      expect(bundle, `${label} link missing or ungated`).toContain(
        `label: "${label}",`,
      );
      expect(bundle).toContain(`hasPermission("${perm}")`);
    }
  });

  it('keeps an admin sidebar short, since İdarə already lists these', () => {
    expect(bundle).toContain('const opsLinks = canAdmin ? []');
  });

  it('never renders an empty sidebar', () => {
    // A till with no way off the current screen is worse than one stray link.
    expect(bundle).toContain('visible.length');
  });

  it('lets every panel it links to actually open', () => {
    // The route was gated on inventory.view alone, which bounced anyone whose
    // only rights were suppliers or delivery off a page built to serve them.
    expect(bundle).not.toContain(
      'jsx(RequirePermission, { permission: "inventory.view" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/operations"',
    );
    expect(bundle).toContain('jsx(Route, { path: "/operations", element:');
  });

  it('highlights one link at a time', () => {
    expect(bundle).toContain('_psNavTabMatches(to, location)');
  });
});

describe('adding staff', () => {
  it('lets the role be chosen instead of making everyone a waiter', () => {
    expect(bundle).toContain('{ fullName: fullName.trim(), pin, role }');
    expect(bundle).not.toContain('pin, role: "waiter" }');
  });

  it('does not offer administrator, which the core refuses to create', () => {
    const list = bundle.match(/\["waiter", "cashier", "kitchen", "storekeeper"[^\]]*\]/);
    expect(list, 'fallback role list not found').toBeTruthy();
    expect(list![0]).not.toContain('administrator');
  });
});
