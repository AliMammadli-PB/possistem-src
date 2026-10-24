/** Parse a small owner-uploaded CSV without interpreting spreadsheet formulas. */
export function parseCsv(input: string): Array<Record<string, string>> {
  const source = input.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      fields.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      fields.push(field); field = '';
      if (fields.some((value) => value.trim())) rows.push(fields);
      fields = [];
    } else field += char;
  }
  if (quoted) throw new Error('CSV faylında bağlanmamış dırnaq var.');
  fields.push(field);
  if (fields.some((value) => value.trim())) rows.push(fields);
  if (rows.length < 2) throw new Error('CSV başlıq və ən azı bir məhsul sətri tələb edir.');
  const header = rows.shift()!.map((value) => value.trim());
  if (!header.includes('name')) throw new Error('CSV-də name başlığı tələb olunur.');
  if (new Set(header).size !== header.length) throw new Error('CSV başlıqları təkrarlanmamalıdır.');
  return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, (values[index] ?? '').trim()])));
}
