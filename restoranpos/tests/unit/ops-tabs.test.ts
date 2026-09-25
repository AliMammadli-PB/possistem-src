/**
 * Two sidebar links share the /operations pathname.
 *
 * Clicking Təchizat showed Anbar: the tab came from a `useState` initialiser,
 * which runs once, so moving between links changed the query without
 * remounting the panel - while the sidebar's active mark, read from
 * `location.search` every render, did move. The nav and the page disagreed.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');

describe('the operations tab', () => {
  it('follows the address instead of a one-time read', () => {
    expect(bundle).not.toContain('new URLSearchParams(window.location.search).get("tab")');
    expect(bundle).toContain('const opsLocation = useLocation();');
    expect(bundle).toContain('tabs.some((tab) => tab.id === wantedTab)');
  });

  it('writes the address back when a tab is clicked, so a reload agrees', () => {
    expect(bundle).toContain('opsNavigate({ pathname: "/operations", search: "?tab=" + id }');
  });

  it('still falls back to the first tab this operator can open', () => {
    expect(bundle).toContain('(tabs[0]?.id ?? "")');
  });
});

describe('supply and vendors', () => {
  it('are two tabs, not one stacked screen', () => {
    expect(bundle).toContain('id: "vendors"');
    expect(bundle).toContain('function OpsVendors() {');
    expect(bundle).toContain('function OpsSuppliers() {');
  });

  it('reaches both from the hub and the sidebar', () => {
    // Count navigation definitions; group metadata and descriptions also name the route.
    expect(bundle.match(/to: "\/operations\?tab=vendors"/g)).toHaveLength(2);
  });

  it('builds the order suggestion from the core, not from the renderer', () => {
    expect(bundle).toContain('window.pos.inventory.lowStock');
    expect(bundle).toContain('Sifariş təklifi hazırla');
  });

  it('reads the supplier ledger by the name the core returns', () => {
    // suppliers.ledger answers { supplierId, dueMinor, entries }.
    expect(bundle).toContain('res.data.entries');
  });

  it('keeps a half-typed purchase when the save fails', () => {
    expect(bundle).toContain('.then((ok) => { if (ok) setDraft(null); })');
    expect(bundle).toContain('.then((ok) => { if (ok) setForm(null); })');
    expect(bundle).toContain('.then((ok) => { if (ok) setPay(null); })');
  });

  it('draws nothing the core cannot answer yet', () => {
    for (const absent of ['Qismən', 'Endirim', 'Çatdırılma haqqı', 'Qiymət tarixçəsi', 'Alternativ']) {
      expect(bundle, `${absent} is drawn without a backend`).not.toContain(`children: "${absent}"`);
    }
  });
});
