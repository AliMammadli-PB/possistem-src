function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ExcelJS is loaded only when a spreadsheet is imported or exported. */
export async function exportXlsx(filename: string, rows: Array<Array<string | number>>) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Məhsullar');
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  download(filename, new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export async function parseXlsx(file: File): Promise<Array<Record<string, string>>> {
  if (file.size > 5 * 1024 * 1024) throw new Error('XLSX faylı 5 MB-dan böyük ola bilməz.');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('XLSX başlıq və ən azı bir məhsul sətri tələb edir.');
  if (sheet.rowCount > 201) throw new Error('Bir dəfəyə ən çox 200 məhsul idxal edin.');
  const header = sheet.getRow(1).values;
  if (!Array.isArray(header)) throw new Error('XLSX başlığı oxunmadı.');
  const keys = header.slice(1).map((value) => String(value ?? '').trim());
  if (!keys.includes('name')) throw new Error('XLSX-də name başlığı tələb olunur.');
  if (new Set(keys).size !== keys.length) throw new Error('XLSX başlıqları təkrarlanmamalıdır.');
  const rows: Array<Record<string, string>> = [];
  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex++) {
    const row = sheet.getRow(rowIndex);
    const values = keys.map((_, index) => {
      const value = row.getCell(index + 1).value;
      if (value && typeof value === 'object') throw new Error(`${rowIndex}-ci XLSX sətrində formula və ya mürəkkəb hüceyrə var.`);
      return String(value ?? '').trim();
    });
    if (values.every((value) => !value)) continue;
    rows.push(Object.fromEntries(keys.map((key, index) => [key, values[index]])));
  }
  if (!rows.length) throw new Error('XLSX-də məhsul sətri yoxdur.');
  return rows;
}
