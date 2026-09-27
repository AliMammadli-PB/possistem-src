/**
 * A stocked clothing store for the possistem.az demo: the real till starts
 * empty, a visitor should see models, sizes and colours straight away.
 * Every variant is one product with its own in-store EAN-13, as the product
 * form creates them.
 */
const MODELS = [
  ['KN-100', 'Oxford köynək', 'Oxford', 'Köynək', 'Kişi', 'Pambıq', 'Bütün mövsüm', 4990, 2100, ['S', 'M', 'L', 'XL'], ['Ağ', 'Açıq mavi', 'Lacivərd']],
  ['FT-210', 'Basic futbolka', 'Cotton Line', 'Futbolka', 'Unisex', 'Pambıq', 'Yaz-Yay', 1990, 700, ['XS', 'S', 'M', 'L', 'XL'], ['Qara', 'Ağ', 'Boz', 'Xaki']],
  ['PL-305', 'Piké polo', 'Cotton Line', 'Polo', 'Kişi', 'Pambıq', 'Yaz-Yay', 3490, 1400, ['S', 'M', 'L', 'XL'], ['Lacivərd', 'Ağ', 'Bordo']],
  ['CN-501', 'Slim fit cins', 'Denim Co', 'Cins', 'Kişi', 'Cins (denim)', 'Bütün mövsüm', 6990, 3000, ['W30', 'W31', 'W32', 'W33', 'W34', 'W36'], ['Cins mavi', 'Qara']],
  ['DN-720', 'Midi don', 'Ladia', 'Don', 'Qadın', 'Viskoz', 'Yaz-Yay', 8990, 3800, ['XS', 'S', 'M', 'L'], ['Qara', 'Bordo', 'Çəhrayı']],
  ['BL-640', 'İpək bluza', 'Ladia', 'Bluza', 'Qadın', 'İpək', 'Bütün mövsüm', 7490, 3200, ['XS', 'S', 'M', 'L'], ['Krem', 'Qara']],
  ['SV-880', 'Yun sviter', 'Nordic', 'Sviter', 'Unisex', 'Yun', 'Payız-Qış', 7990, 3400, ['S', 'M', 'L', 'XL'], ['Bej', 'Antrasit', 'Yaşıl']],
  ['HD-410', 'Hudi', 'Street', 'Hudi', 'Unisex', 'Trikotaj', 'Payız-Qış', 5990, 2500, ['S', 'M', 'L', 'XL', 'XXL'], ['Qara', 'Boz', 'Zeytun']],
  ['PL-990', 'Kəmərli palto', 'Nordic', 'Palto', 'Qadın', 'Yun', 'Payız-Qış', 19990, 9000, ['42', '44', '46', '48'], ['Kamel', 'Qara']],
  ['GD-770', 'Puf gödəkcə', 'Street', 'Gödəkcə', 'Kişi', 'Poliester', 'Payız-Qış', 14990, 6500, ['M', 'L', 'XL', 'XXL'], ['Qara', 'Lacivərd', 'Xaki']],
  ['ET-330', 'Plisse ətək', 'Ladia', 'Ətək', 'Qadın', 'Poliester', 'Bütün mövsüm', 4990, 2000, ['XS', 'S', 'M', 'L'], ['Qara', 'Bej']],
  ['IA-120', 'Qaçış ayaqqabısı', 'Runner', 'İdman ayaqqabısı', 'Unisex', 'Tekstil', 'Bütün mövsüm', 12990, 6000, ['38', '39', '40', '41', '42', '43', '44'], ['Ağ', 'Qara']],
  ['CK-450', 'Dəri çəkmə', 'Runner', 'Çəkmə', 'Qadın', 'Təbii dəri', 'Payız-Qış', 17990, 8200, ['36', '37', '38', '39', '40'], ['Qara', 'Qəhvəyi']],
  ['CT-060', 'Dəri çanta', 'Ladia', 'Çanta', 'Qadın', 'Təbii dəri', 'Bütün mövsüm', 11990, 5200, ['Tək ölçü'], ['Qara', 'Kamel', 'Bordo']],
  ['KM-015', 'Dəri kəmər', 'Oxford', 'Kəmər', 'Kişi', 'Təbii dəri', 'Bütün mövsüm', 2990, 1100, ['90', '95', '100', '105'], ['Qara', 'Qəhvəyi']],
  ['UF-230', 'Uşaq futbolkası', 'Mini', 'Uşaq geyimi', 'Oğlan', 'Pambıq', 'Yaz-Yay', 1290, 450, ['98', '104', '110', '116', '122'], ['Mavi', 'Sarı', 'Ağ']],
];
const HEX = {
  Qara: '#1b1b1f', Ağ: '#f4f4f1', Boz: '#8a8d93', Antrasit: '#3d4046', Lacivərd: '#1f2f56', Mavi: '#2f6fd1', 'Açıq mavi': '#8ec3ea',
  'Cins mavi': '#4a6a93', Bej: '#d9c3a0', Krem: '#efe4cc', Qəhvəyi: '#6b4429', Kamel: '#b88449', Xaki: '#78784a', Yaşıl: '#2f8a4e',
  Zeytun: '#5d6b32', Bordo: '#6d1f2c', Çəhrayı: '#e89ab4', Sarı: '#f0c419',
};
const ascii = (value) => value.normalize('NFKD').replace(/[əƏ]/g, 'E').replace(/[ıİ]/g, 'I').replace(/[^\w]/g, '').toUpperCase().slice(0, 6) || 'X';

function ean13(body12) {
  const sum = [...body12].reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body12}${(10 - (sum % 10)) % 10}`;
}

export function demoCatalog() {
  const products = [];
  let serial = 1000;
  MODELS.forEach(([article, name, brand, category, gender, material, season, priceMinor, costMinor, sizes, colors], m) => {
    const parent = `p-demo-${article.toLowerCase()}`;
    colors.forEach((color, c) => sizes.forEach((size, s) => {
      serial += 1;
      // Some cells sold out, so the size picker shows greyed sizes too.
      const stock = (m + c * 3 + s * 2) % 7 === 0 ? 0 : 1 + ((m + c + s * 3) % 6);
      products.push({
        id: `${parent}-${ascii(color)}-${ascii(size)}`.toLowerCase(),
        parentProductId: parent,
        internalCode: article,
        sku: `${ascii(article)}-${ascii(color)}-${ascii(size)}`,
        barcode: ean13(`20${String(serial).padStart(10, '0')}`),
        name: { az: name, ru: name, en: name },
        category, unit: category.includes('ayaqqabı') || category === 'Çəkmə' ? 'cüt' : 'əd',
        priceMinor, costMinor, minStock: 1, taxRate: 18, supplier: brand,
        accent: HEX[color] ?? '#0a4f9c', image: { kind: 'url', url: '' }, active: true, createdAt: Date.now(),
        color, size, brand, material, season, gender, kind: 'product', stock,
      });
    }));
  });
  return products;
}
