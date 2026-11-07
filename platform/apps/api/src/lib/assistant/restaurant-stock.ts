// Only the authenticated owner's devices are supplied by answerAccount. Read-only
// inventory RPC; menu availability and an offline cache are never called stock.
type Device = {id: string; name: string};
type Data = Record<string, any>;
export async function readRestaurantStock<D extends Device>(devices: D[], online: (device: D) => boolean, read: (device: D, method: string, payload?: Data) => Promise<Data | null>) {
 const sections: {branch: string; warehouse: string; products: {name: string; unit: string; qtyMilli: number | null}[]; more: boolean}[] = [];
 const unavailable: string[] = [];
 // Bound work even for large accounts; the full workspace remains available.
 await Promise.all(devices.slice(0, 3).map(async device => {
  if (!online(device)) {unavailable.push(device.name); return;}
  try {
   const data = await read(device, 'warehouses.list');
   if (!Array.isArray(data?.warehouses)) throw Error('warehouses unavailable');
   const warehouses = data.warehouses.filter((w: Data) => w.active !== false && w.active !== 0);
   if (!warehouses.length) throw Error('no warehouse');
   await Promise.all(warehouses.slice(0, 6).map(async (warehouse: Data) => {
    const result = await read(device, 'inventory.levels', {warehouseId: warehouse.id});
    if (!Array.isArray(result?.levels)) throw Error('stock unavailable');
    sections.push({branch: device.name, warehouse: String(warehouse.name), products: result.levels.slice(0, 40).map((p: Data) => ({name: String(p.name ?? p.id), unit: String(p.unit ?? ''), qtyMilli: Number.isSafeInteger(p.qtyMilli) ? p.qtyMilli : null})), more: result.levels.length > 40});
   }));
   if (warehouses.length > 6) unavailable.push(device.name + ' (digər anbarlar portalda)');
  } catch {unavailable.push(device.name);}
 }));
 sections.sort((a,b)=>a.branch.localeCompare(b.branch)||a.warehouse.localeCompare(b.warehouse));
 if (devices.length > 3) unavailable.push('digər kassalar portalda');
 return {sections, unavailable};
}
