import { renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Vite names the output after its input (market.html); nginx serves
// /marketpos/ from index.html.
const dir = resolve(import.meta.dirname, '../dist-market');
const from = resolve(dir, 'market.html');
const to = resolve(dir, 'index.html');
if (!existsSync(from)) {
  console.error('dist-market/market.html not found — did vite build run?');
  process.exit(1);
}
renameSync(from, to);
console.log('renamed dist-market/market.html -> index.html');
