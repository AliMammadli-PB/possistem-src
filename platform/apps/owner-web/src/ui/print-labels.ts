type Label = { name: string; barcode: string; salePrice: number };

export async function printLabels(rows: Label[]) {
  if (!rows.length) throw new Error('Etiket üçün məhsul seçilməyib.');
  if (rows.length > 100) throw new Error('Bir dəfəyə ən çox 100 etiket çap edin; əvvəl siyahını filtrləyin.');
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Çap pəncərəsi bloklandı.');
  try {
    const JsBarcode = (await import('jsbarcode')).default;
    const doc = popup.document;
    doc.title = 'Məhsul etiketləri';
    const style = doc.createElement('style');
    style.textContent = '@page{size:A4;margin:8mm}body{font-family:Arial,sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin:0}.label{width:60mm;height:34mm;box-sizing:border-box;border:1px solid #ddd;padding:2mm;overflow:hidden;break-inside:avoid}.name{font-size:11px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.price{font-size:15px;font-weight:bold;text-align:right}.barcode{width:100%;height:18mm}@media print{.label{border:0}}';
    doc.head.appendChild(style);
    for (const row of rows) {
      const card = doc.createElement('article');
      card.className = 'label';
      const name = doc.createElement('div');
      name.className = 'name';
      name.textContent = row.name;
      card.appendChild(name);
      const price = doc.createElement('div');
      price.className = 'price';
      price.textContent = `${(row.salePrice / 100).toFixed(2)} ₼`;
      card.appendChild(price);
      if (row.barcode) {
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'barcode');
        card.appendChild(svg);
        try {
          JsBarcode(svg, row.barcode, { format: 'CODE128', width: 1, height: 28, margin: 0, fontSize: 10 });
        } catch {
          svg.remove();
          const code = doc.createElement('div');
          code.textContent = row.barcode;
          card.appendChild(code);
        }
      }
      doc.body.appendChild(card);
    }
    popup.setTimeout(() => popup.print(), 300);
  } catch (error) {
    popup.close();
    throw error;
  }
}
