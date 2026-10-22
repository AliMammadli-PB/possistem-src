'use strict';
const { createHash } = require('node:crypto');
const locks = new WeakMap();
const unitKey = unit => String(unit || '').trim().toLocaleLowerCase('az');
const checked = result => { if (!result?.success) throw new Error(result?.error?.message || 'Məhsul kartı saxlanmadı'); return result.data; };

/** Only owner-scoped, signed snapshots read by main can supply a foreign card. Never import quantities. */
async function importBranchProduct({ ops, snapshots, activation, reference, staff, can }) {
  if (staff?.role !== 'manager' || !await can('CREATE_PRODUCT') || !await can('DOCS_CREATE')) throw new Error('Məhsul və alış qaiməsi yaratmağa icazəniz yoxdur');
  if (!activation?.customerId || !activation?.serverDeviceId) throw new Error('Sahibkar hesabına daxil olun');
  const source = snapshots.find(s => s.deviceId === reference?.deviceId);
  if (!source || source.deviceId === activation.serverDeviceId || source.branchId && source.branchId === activation.cloudBranchId) throw new Error('Məhsulun filialı tapılmadı. Siyahını yeniləyin');
  const good = source.lines?.find(g => g.goodId === reference?.goodId);
  if (!good?.name || !['kg', 'l', 'ədəd', 'qab', 'q'].includes(good.unit)) throw new Error('Məhsul və ya ölçü vahidi düzgün deyil');
  // Serialize both different source references to the same barcode and repeated clicks.
  const previous = locks.get(ops) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const goods = checked(await ops.invoke('ingredients.list', {}, { timeoutMs: 60000 })).ingredients || [];
    const barcode = String(good.barcode || '');
    const digest = createHash('sha256').update(JSON.stringify([activation.customerId, barcode ? ['barcode', barcode, unitKey(good.unit)] : ['branch', source.branchId || source.deviceId, good.goodId]])).digest('hex').slice(0, 32);
    const id = 'branch-' + digest;
    const existing = goods.find(g => barcode ? g.barcode === barcode : g.sku === id);
    if (existing) {
      if (unitKey(existing.unit) !== unitKey(good.unit)) throw new Error('Bu barkodun cari filialdakı ölçü vahidi fərqlidir');
      return { good: existing, created: false };
    }
    const created = checked(await ops.invoke('ingredients.save', { sku: id, name: String(good.name).slice(0, 200), barcode, unit: good.unit, costMinor: 0, salePriceMinor: Math.max(0, Math.round(Number(good.salePriceMinor) || 0)), idempotencyKey: 'branch-card-' + digest }, { terminal: { id: 'market-ops', name: staff.name }, timeoutMs: 30000 }));
    // The response is the local card; stock remains zero until a receipt is confirmed.
    const saved = (checked(await ops.invoke('ingredients.list', {}, { timeoutMs: 60000 })).ingredients || []).find(g => g.id === created.id);
    if (!saved) throw new Error('Məhsul kartı yenilənmədi. Siyahını yeniləyin');
    return { good: saved, created: true };
  });
  locks.set(ops, task);
  try { return await task; } finally { if (locks.get(ops) === task) locks.delete(ops); }
}
module.exports = { importBranchProduct };
