/** Exports the exact rows visible in a portal table; Excel opens UTF-8 BOM CSV. */
export function exportCsv(filename: string, rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => {
    const raw = String(value ?? '');
    const safe = /^[\s]*[=+\-@]/.test(raw) && typeof value === 'string' ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const content = '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
