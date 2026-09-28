/**
 * A stocked pharmacy for the possistem.az demo: the real till starts empty, a
 * visitor should find medicines, open packs, prescription medicines and lots
 * with an expiry (one already close, to show the warning) straight away.
 */
const DAY = 86_400_000;
// [name, inn, strength, form, category, packUnits, split, rx, storage, manufacturer, pack price (qəpik), cost, lots: [days to expiry, packs]]
const MEDICINES = [
  ['Parasetamol', 'Paracetamol', '500 mq', 'tablet', 'Ağrıkəsici', 20, true, false, 'room', 'Azerfarm', 180, 90, [[520, 30], [70, 6]]],
  ['İbuprofen', 'Ibuprofen', '400 mq', 'tablet', 'Ağrıkəsici', 20, true, false, 'room', 'Berlin-Chemie', 420, 230, [[610, 20]]],
  ['Nurofen Uşaq sirop', 'Ibuprofen', '100 mq/5 ml', 'syrup', 'Uşaq', 1, false, false, 'room', 'Reckitt', 890, 560, [[300, 12]]],
  ['Amoksisillin', 'Amoxicillin', '500 mq', 'capsule', 'Antibiotik', 16, false, true, 'room', 'Sandoz', 650, 360, [[45, 8], [400, 10]]],
  ['Azitromisin', 'Azithromycin', '500 mq', 'tablet', 'Antibiotik', 3, false, true, 'room', 'Pliva', 1250, 700, [[380, 10]]],
  ['Amlodipin', 'Amlodipine', '5 mq', 'tablet', 'Ürək-damar', 30, true, true, 'room', 'Gedeon Richter', 560, 300, [[720, 15]]],
  ['Metformin', 'Metformin', '850 mq', 'tablet', 'Diabet', 60, true, true, 'room', 'Merck', 780, 420, [[500, 10]]],
  ['İnsulin Aspart FlexPen', 'Insulin aspart', '100 BV/ml', 'ampoule', 'Diabet', 5, true, true, 'cool', 'Novo Nordisk', 7400, 5200, [[200, 6]]],
  ['Omeprazol', 'Omeprazole', '20 mq', 'capsule', 'Mədə-bağırsaq', 30, true, false, 'room', 'KRKA', 650, 330, [[610, 14]]],
  ['Loratadin', 'Loratadine', '10 mq', 'tablet', 'Allergiya', 10, false, false, 'room', 'Azerfarm', 320, 150, [[540, 25]]],
  ['Ambroksol sirop', 'Ambroxol', '15 mq/5 ml', 'syrup', 'Öskürək', 1, false, false, 'room', 'Berlin-Chemie', 610, 340, [[420, 15]]],
  ['Salbutamol inhalyator', 'Salbutamol', '100 mkq/doza', 'inhaler', 'Tənəffüs', 1, false, true, 'room', 'GSK', 980, 610, [[640, 8]]],
  ['Vitamin D3 damcı', 'Cholecalciferol', '500 BV/damcı', 'drops', 'Vitamin', 1, false, false, 'dark', 'Akvadetrim', 1150, 640, [[480, 18]]],
  ['Vitamin C', 'Ascorbic acid', '1000 mq', 'tablet', 'Vitamin', 20, false, false, 'room', 'Bayer', 860, 470, [[360, 20]]],
  ['Diklofenak gel', 'Diclofenac', '1%', 'ointment', 'Dəri', 1, false, false, 'room', 'Novartis', 740, 400, [[560, 16]]],
  ['Oksimetazolin sprey', 'Oxymetazoline', '0.05%', 'spray', 'Göz-qulaq', 1, false, false, 'room', 'Merck', 690, 380, [[330, 14]]],
  ['Göz damcısı Süni göz yaşı', 'Hypromellose', '0.3%', 'drops', 'Göz-qulaq', 1, false, false, 'room', 'Santen', 920, 520, [[25, 4], [410, 10]]],
  ['Xlorheksidin məhlulu', 'Chlorhexidine', '0.05% · 100 ml', 'syrup', 'Antiseptik', 1, false, false, 'room', 'Azerfarm', 190, 90, [[700, 30]]],
  ['Steril sarğı 7m×14sm', '', '', 'patch', 'Sarğı', 1, false, false, 'room', 'Hartmann', 150, 70, [[1000, 40]]],
  ['Rəqəmsal termometr', '', '', 'device', 'Tibbi cihaz', 1, false, false, 'room', 'Omron', 1590, 950, [[1500, 6]]],
];

function ean13(body12) {
  const sum = [...body12].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body12}${(10 - (sum % 10)) % 10}`;
}

export function demoCatalog() {
  const now = Date.now();
  return MEDICINES.map(([name, inn, strength, form, category, packUnits, split, rx, storage, manufacturer, packPrice, packCost, lots], index) => {
    const per = split ? packUnits : 1;
    const barcode = ean13(`20${String(3000 + index).padStart(10, '0')}`);
    return {
      product: {
        id: `p-demo-med-${index + 1}`, sku: `MED-${String(index + 1).padStart(3, '0')}`, barcode,
        name: { az: name, ru: name, en: name }, category, unit: split ? 'ədəd' : 'qutu',
        priceMinor: Math.round(packPrice / per), costMinor: Math.round(packCost / per), minStock: 2 * per, taxRate: 18,
        supplier: manufacturer, accent: '#0e7c86', image: { kind: 'url', url: '' }, active: true, createdAt: now, kind: 'product',
        inn, strength, dosageForm: form, packUnits, splitAllowed: split, rxRequired: rx, storage, manufacturer, country: '', regNo: '', stock: 0,
      },
      lots: lots.map(([days, packs], lot) => ({ lotNumber: `${barcode.slice(-4)}-${lot + 1}`, expiresAt: now + days * DAY, qty: packs * per })),
    };
  });
}
