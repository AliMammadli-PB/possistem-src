/**
 * A stocked wholesale warehouse for the possistem.az demo: the real till
 * starts empty, a visitor should find goods in cases and sacks with three
 * price levels, warehouse locations, and shops that buy on credit straight away.
 */
// [name, brand, category, piece unit, pack name, pieces per pack, sold loose, cost/pack, retail/pack, wholesale/pack, dealer/pack (qəpik), packs in stock, location]
const GOODS = [
  ['Su 1.5 L', 'Sirab', 'Su', 'şüşə', 'yeşik', 6, true, 540, 900, 720, 600, 180, 'A-1'],
  ['Su 0.5 L', 'Badamlı', 'Su', 'şüşə', 'yeşik', 12, true, 480, 840, 690, 600, 140, 'A-1'],
  ['Kola 1 L', 'Coca-Cola', 'İçkilər', 'şüşə', 'yeşik', 12, true, 1920, 2880, 2520, 2340, 90, 'A-2'],
  ['Meyvə şirəsi 1 L', 'Sirab', 'İçkilər', 'paket', 'qutu', 12, true, 1680, 2640, 2280, 2100, 70, 'A-2'],
  ['Qara çay 250 q', 'Azərçay', 'Çay və qəhvə', 'paket', 'qutu', 20, true, 5400, 8000, 7000, 6600, 45, 'B-1'],
  ['Qəhvə 3in1', 'Nescafe', 'Çay və qəhvə', 'paket', 'blok', 50, true, 1500, 2500, 2100, 1950, 60, 'B-1'],
  ['Şəkər 1 kq', 'Azərsun', 'Şəkər və duz', 'paket', 'kisə', 10, true, 1400, 1900, 1700, 1600, 120, 'C-1'],
  ['Un 50 kq', 'Bakı Dəyirman', 'Un və taxıl', 'kisə', '', 1, true, 3200, 4200, 3800, 3600, 80, 'C-1'],
  ['Düyü 1 kq', 'Aura', 'Makaron', 'paket', 'kisə', 10, true, 2100, 3000, 2600, 2450, 60, 'C-2'],
  ['Makaron 400 q', 'Makfa', 'Makaron', 'paket', 'qutu', 20, true, 1500, 2400, 2000, 1900, 75, 'C-2'],
  ['Günəbaxan yağı 1 L', 'Zəfər', 'Yağlar', 'şüşə', 'yeşik', 12, true, 3120, 4200, 3720, 3480, 55, 'C-3'],
  ['Pomidor pastası 700 q', 'Globus', 'Konserv', 'banka', 'qutu', 12, true, 2280, 3360, 2880, 2700, 40, 'D-1'],
  ['Noxud konservi', 'Bonduelle', 'Konserv', 'banka', 'qutu', 12, true, 1680, 2520, 2160, 2040, 35, 'D-1'],
  ['Şokolad batonu', 'Snickers', 'Şirniyyat', 'ədəd', 'blok', 40, true, 2400, 4000, 3200, 3000, 50, 'D-2'],
  ['Peçenye 250 q', 'Bizim Süfrə', 'Peçenye', 'paket', 'qutu', 24, true, 2160, 3360, 2880, 2640, 45, 'D-2'],
  ['Yuyucu toz 3 kq', 'Ariel', 'Məişət kimyası', 'paket', 'qutu', 4, true, 3600, 5200, 4600, 4400, 30, 'E-1'],
  ['Qab yuyucu 1 L', 'Fairy', 'Məişət kimyası', 'şüşə', 'yeşik', 12, true, 2640, 3960, 3360, 3120, 30, 'E-1'],
  ['Tualet kağızı 8 li', 'Selpak', 'Kağız məhsulları', 'paket', 'kisə', 6, true, 2700, 3900, 3420, 3240, 40, 'E-2'],
  ['Şampun 400 ml', 'Head&Shoulders', 'Gigiyena', 'şüşə', 'qutu', 12, false, 5400, 8160, 7080, 6720, 25, 'E-2'],
  ['Kisə polietilen 50 li', 'Plast', 'Qablaşdırma', 'paket', 'qutu', 20, true, 1600, 3000, 2400, 2200, 35, 'F-1'],
];

const LOCATIONS = [
  ['A-1', 'Sıra A · su'], ['A-2', 'Sıra A · içkilər'], ['B-1', 'Sıra B · çay, qəhvə'], ['C-1', 'Sıra C · şəkər, un'],
  ['C-2', 'Sıra C · düyü, makaron'], ['C-3', 'Sıra C · yağlar'], ['D-1', 'Sıra D · konserv'], ['D-2', 'Sıra D · şirniyyat'],
  ['E-1', 'Sıra E · məişət kimyası'], ['E-2', 'Sıra E · gigiyena, kağız'], ['F-1', 'Sıra F · qablaşdırma'],
];
export const demoShelves = () => LOCATIONS.map(([code, zone], sort) => ({ code, zone, sort }));

// Shops that buy from the warehouse: price level, credit limit (qəpik) and what they already owe.
const CUSTOMERS = [
  ['Nərgiz Market', '1301234561', 'Bakı, Yasamal, Ş. Mehdiyev 12', '+994 50 555 11 22', 'wholesale', 300000],
  ['Araz Supermarket (filial 7)', '1401234562', 'Bakı, Nəsimi, Azadlıq pr. 81', '+994 12 440 22 33', 'dealer', 1000000],
  ['Ləman ərzaq', '1501234563', 'Sumqayıt, 9-cu mkr', '+994 55 321 44 55', 'wholesale', 150000],
  ['Kənd mağazası — Qəbələ', '', 'Qəbələ, Vəndam kəndi', '+994 70 210 66 77', 'wholesale', 0],
  ['Rəhim Diler (Gəncə)', '1601234564', 'Gəncə, Nizami küç. 5', '+994 51 777 88 99', 'dealer', 2000000],
];
export const demoCustomers = () => CUSTOMERS.map(([name, voen, address, phone, priceTier, limit]) => ({
  name, voen, address, phone, priceTier, creditAllowed: limit > 0, creditLimitMinor: limit, note: '',
}));

function ean13(body12) {
  const sum = [...body12].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body12}${(10 - (sum % 10)) % 10}`;
}

export function demoCatalog(warehouseId) {
  const now = Date.now();
  return GOODS.map(([name, brand, category, unit, packName, per, loose, cost, retail, wholesale, dealer, packs, shelf], index) => {
    const piece = (packMinor) => Math.round(packMinor / per);
    return {
      id: `p-demo-goods-${index + 1}`, sku: `TOP-${String(index + 1).padStart(3, '0')}`, barcode: ean13(`20${String(5000 + index).padStart(10, '0')}`),
      name: { az: name, ru: name, en: name }, category, unit, packName, packUnits: per, splitAllowed: loose,
      priceMinor: piece(retail), priceWholesaleMinor: piece(wholesale), priceDealerMinor: piece(dealer), costMinor: piece(cost),
      minStock: 10 * per, taxRate: 18, supplier: brand, manufacturer: brand, shelf, accent: '#0a4f9c',
      image: { kind: 'url', url: '' }, active: true, createdAt: now, kind: 'product',
      warehouseStock: { [warehouseId]: packs * per },
    };
  });
}
