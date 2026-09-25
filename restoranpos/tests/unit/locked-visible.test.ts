/**
 * Buttons stay; the ones you may not use say so.
 *
 * The owner's rule for both tills: a missing permission never removes an icon
 * or a button - pressing it answers "Buna icazəniz yoxdur". What would rot:
 * a list quietly filtered by permission again, or a refused core call shown in
 * the core's own English.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'out/preload/index.js'), 'utf8');
const market = fs.readFileSync(path.join(ROOT, '../marketpos/src/App.tsx'), 'utf8');
const marketClient = fs.readFileSync(path.join(ROOT, '../marketpos/src/core/client.ts'), 'utf8');

describe('restaurant till', () => {
  it('renders every sidebar link and refuses the locked ones', () => {
    expect(bundle).not.toContain('links.filter((l) => l.show).map');
    expect(bundle).toContain('onClick: _psOk ? void 0 : (event) => { event.preventDefault(); _psDenied(); }');
  });

  it('keeps every İdarə card and Əməliyyat tab', () => {
    expect(bundle).toContain('].map((l) => ({ ...l, locked: !(l.show && _psArea(l.to)) }))');
    expect(bundle).toContain('children: _psTabs.map((tab) =>');
    expect(bundle).toContain('onClick: () => tab.show ? setActive(tab.id) : _psDenied()');
  });

  it('keeps the money buttons and refuses without the permission', () => {
    expect(bundle).toContain('onClick: () => canX ? void runXReport() : _psDenied()');
    expect(bundle).toContain('onClick: () => canZ ? void openZClose() : _psDenied()');
    expect(bundle).toContain('onClick: () => canRefund ? openRefund(p) : _psDenied()');
    expect(bundle).toContain('onClick: () => canSplit ? setSplitDialog(true) : _psDenied()');
    expect(bundle).toContain('if (!canTransfer) { _psDenied(); return; }');
    expect(bundle).toContain('if (!canLayout) { _psDenied(); return; }');
  });

  it('shows one message for every refusal the core sends', () => {
    expect(bundle).toContain('toast("Buna icazəniz yoxdur", "danger")');
    expect(preload).toContain('result.error.code === "E_FORBIDDEN"');
    expect(preload).toContain('result.error.message = "Buna icazəniz yoxdur"');
  });
});

describe('refusal toast answers a person, not a background read', () => {
  it('toasts only right after a tap, click or key', () => {
    expect(bundle).toContain('window.addEventListener("ps:denied", () => { if (Date.now() - window.__psLastInput < 2000) _psDenied(); });');
  });

  it('does not ask for dish costs without inventory.view', () => {
    expect(bundle).toContain('if (!useAuthStore.getState().hasPermission("inventory.view")) return;');
  });
});

describe('market till', () => {
  it('renders every screen in the sidebar and refuses the locked ones', () => {
    expect(market).not.toContain('const nav = allNav.filter(');
    expect(market).toContain("onClick={() => locked ? deny() : safeSetView(id)}");
  });

  it('keeps the stock buttons for everyone', () => {
    expect(market).not.toContain('{canEdit && (');
  });

  it('shows one message for a refused core call', () => {
    expect(marketClient).toContain("PERMISSION_DENIED");
    expect(marketClient).toContain('Buna icazəniz yoxdur');
  });
});
