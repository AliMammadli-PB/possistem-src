/**
 * Kalkulyasiya, the screen half.
 *
 * The figures come from the core and are tested there. What can rot here is
 * how the screen presents them: a dish whose cost is unknown shown as a
 * number, a list sorted by name that nobody acts on, or a bridge and gate that
 * forget the new method and leave the tab answering nothing.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = fs.readFileSync(path.join(ROOT, 'index-DAmHwBc4.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'out/preload/index.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const protocol = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'shared/contracts/protocol.json'), 'utf8'),
);

describe('the costing screen', () => {
  it('reaches the core through every layer', () => {
    expect(protocol.methods['reports.costing']).toBeTruthy();
    expect(protocol.methods['reports.costing'].perm).toBe('inventory.view');
    expect(preload).toContain('call("reports.costing"');
    expect(main).toContain('reports.costing');
    expect(bundle).toContain('window.pos.inventory.costing()');
  });

  it('is a tab of its own', () => {
    expect(bundle).toContain('function OpsCosting()');
    expect(bundle).toContain('id: "costing", label: "Kalkulyasiya"');
    // The hub titles every tab it can land on; without an entry the header is
    // blank and the screen reads half-built.
    expect(bundle).toContain('costing: ["Kalkulyasiya"');
  });

  it('never shows an unknown cost as a number', () => {
    // A dish with no recipe is not cheap, it is unanswered. Printing 0.00 for
    // it is the one presentation that makes the problem invisible.
    expect(bundle).toContain('row.hasRecipe ? formatMoney(row.costMinor ?? 0) : "—"');
    expect(bundle).toContain('label: "Kalkulyasiya yoxdur"');
  });

  it('says when a cost is built on ingredients with no price', () => {
    expect(bundle).toContain('label: "Maya dəyəri yazılmayıb"');
    expect(bundle).toContain('maya dəyəri yazılmamış məhsul var');
  });

  it('opens on the dishes worth acting on', () => {
    // Sorted by food cost, worst first. A list sorted by name is a list nobody
    // reads twice.
    expect(bundle).toContain('reactExports.useState("worst")');
    expect(bundle).toContain('if (sort === "worst") return (b.foodCostBp ?? 0) - (a.foodCostBp ?? 0);');
  });

  it('formats basis points without a float crossing the bridge', () => {
    expect(bundle).toContain('const pct = (bp) => (Number(bp) / 100).toFixed(1) + "%";');
  });

  it('lets the owner write a recipe from the costing screen', () => {
    expect(preload).toContain('saveRecipe:');
    expect(preload).toContain('call("recipes.save"');
    expect(bundle).toContain('window.pos.inventory.saveRecipe');
    expect(bundle).toContain('window.pos.inventory.recipe');
    expect(bundle).toContain('Resept yaz');
    expect(bundle).toContain('hasPermission("recipes.manage")');
    expect(bundle).toContain('Məhsul əlavə et');
    expect(bundle).toContain('Məhsul " + (i + 1)');
    expect(bundle).toContain('Sətir mayası:');
    expect(bundle).toContain('Cəm maya');
    expect(bundle).toContain('unit: "q"');
    expect(bundle).toContain('Porsiya üçün vahidi qram seçin');
    expect(bundle).toContain('Total qazanc:');
    expect(bundle).toContain('totalProfitMinor');
  });
});
