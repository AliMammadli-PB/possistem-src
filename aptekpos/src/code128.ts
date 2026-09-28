/**
 * CODE128 for printed clothing tags, drawn as SVG (no library). Digit runs use
 * code set C (two digits per symbol), everything else code set B.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const TO_B = 100;
const STOP = 106;

/** Symbol values including start and checksum, without stop. */
export function code128Symbols(text: string): number[] {
  if (!text || [...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126)) throw new Error('CODE128: printable ASCII only');
  const digitsHead = /^\d+/.exec(text)?.[0] ?? '';
  const evenHead = digitsHead.length >= 4 ? digitsHead.slice(0, digitsHead.length - (digitsHead.length % 2)) : '';
  const symbols: number[] = [];
  if (evenHead) {
    symbols.push(START_C);
    for (let i = 0; i < evenHead.length; i += 2) symbols.push(Number(evenHead.slice(i, i + 2)));
    if (evenHead.length < text.length) symbols.push(TO_B);
  } else symbols.push(START_B);
  for (const ch of text.slice(evenHead.length)) symbols.push(ch.charCodeAt(0) - 32);
  const checksum = symbols.reduce((sum, value, index) => sum + value * Math.max(1, index), 0) % 103;
  return [...symbols, checksum];
}

/** Bar/space module widths, starting with a bar, including the stop. */
export function code128Modules(text: string): number[] {
  return [...code128Symbols(text), STOP].flatMap((value) => [...PATTERNS[value]!].map(Number));
}

/** An SVG barcode with a 10-module quiet zone either side. */
export function code128Svg(text: string, height = 40): string {
  const modules = code128Modules(text);
  const total = modules.reduce((sum, width) => sum + width, 0) + 20;
  let x = 10;
  const bars: string[] = [];
  modules.forEach((width, index) => {
    if (index % 2 === 0) bars.push(`M${x} 0h${width}v${height}h-${width}Z`);
    x += width;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><path d="${bars.join('')}" fill="#000"/></svg>`;
}
