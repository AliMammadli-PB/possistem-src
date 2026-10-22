/** 1.5.61: Parametrlər → Tərəzi layout logic (src/scaleBarcode.ts), bundled with esbuild. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scale-layout-'));
const out = path.join(dir, 'scale.mjs');
await build({ entryPoints: [path.join(root, 'src/scaleBarcode.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const m = await import(pathToFileURL(out).href);
try {
  // Dahua descriptions match the manual's factory barcodes (Table 5-4: 1 and 4).
  assert.equal(m.SCALE_PRESETS.find((p) => p.id === 'p5').dahua, 'B201E500K500A000A000A000');
  assert.equal(m.SCALE_PRESETS.find((p) => p.id === 'p6').dahua, 'B201E400K600A000A000A000');
  assert.equal(m.SCALE_PRESETS.find((p) => p.id === 'w5').dahua, 'B201E500J500A000A000A000');
  assert.equal(m.checkDigit('200001200310'), Number(m.sampleBarcode({ prefixes: ['20'], pluLen: 5, valueLen: 5, mode: 'WEIGHT', decimals: 3 }, 12, 310).at(-1)));

  // Rules round-trip, and the seeded 019 rules read as preset w5.
  const layout = { prefixes: ['20', '21'], pluLen: 4, valueLen: 6, mode: 'PRICE', decimals: 2 };
  assert.deepEqual(m.layoutFromRules(m.rulesFromLayout(layout)), layout);
  const seeded = m.ALL_PREFIXES.map((prefix) => ({ prefix, pluStart: 2, pluLen: 5, valueStart: 7, valueLen: 5, decimals: 3, mode: 'WEIGHT', checkChecksum: true }));
  assert.equal(m.presetOf(m.layoutFromRules(seeded)).id, 'w5');
  assert.equal(m.validLayout({ ...layout, valueLen: 5 }), 'sum');
  assert.equal(m.validLayout({ ...layout, prefixes: [] }), 'prefix');

  // Automatic: an 8.00/kg good, label 0.850 kg = 6.80 AZN.
  const goods = [{ id: 'a', name: 'Alma', plu: '00012', priceMinor: 800, unit: 'kq' }];
  const weightLabel = m.sampleBarcode({ prefixes: ['20'], pluLen: 5, valueLen: 5, mode: 'WEIGHT', decimals: 3 }, 12, 850);
  const priceLabel = m.sampleBarcode({ prefixes: ['22'], pluLen: 5, valueLen: 5, mode: 'PRICE', decimals: 2 }, 12, 680);
  assert.equal(m.detectLayout(weightLabel, goods, { totalMinor: 680 })[0].preset.id, 'w5');
  assert.equal(m.detectLayout(weightLabel, goods, { kg: 0.85 })[0].preset.id, 'w5');
  assert.equal(m.detectLayout(priceLabel, goods, { totalMinor: 680 })[0].preset.id, 'p5');
  assert.equal(m.detectLayout(priceLabel, goods, { kg: 0.85 })[0].preset.id, 'p5');
  const best = m.detectLayout(priceLabel, goods, { totalMinor: 680 })[0];
  assert.equal(best.good.id, 'a'); assert.equal(best.kg, 0.85);
  assert.deepEqual(m.detectLayout('4760001000001', goods), [], 'only 20-29 labels');
  // A wrong check digit never wins.
  const broken = priceLabel.slice(0, 12) + ((Number(priceLabel[12]) + 1) % 10);
  assert.ok(m.detectLayout(broken, goods, { totalMinor: 680 })[0].reading.checksumOk === false);
  console.log('PASS scale layout: Dahua descriptions match factory barcodes 1/4, rules round-trip, seeded rules = preset, automatic detection picks weight vs total from one label.');
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
