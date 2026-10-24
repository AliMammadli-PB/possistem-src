import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexPath = resolve(import.meta.dirname, '../chat/index.html');
let html = readFileSync(indexPath, 'utf8');
const map = [
  [/href="\/chat\/assets\/apple-touch-icon-[^"]+\.png"/g, 'href="/chat/mr-apple-touch-icon.png"'],
  [/href="\/chat\/assets\/icon-192-[^"]+\.png"/g, 'href="/chat/mr-icon-192.png"'],
  [/href="\/chat\/assets\/icon-512-[^"]+\.png"/g, 'href="/chat/mr-icon-512.png"'],
  [/href="\/chat\/assets\/favicon-[^"]+\.png"/g, 'href="/chat/mr-favicon.png"'],
  [/href="\/chat\/assets\/manifest-[^"]+\.webmanifest"/g, 'href="/chat/manifest.webmanifest"'],
  [/href="\/chat\/apple-touch-icon\.png"/g, 'href="/chat/mr-apple-touch-icon.png"'],
  [/href="\/chat\/icon-192\.png"/g, 'href="/chat/mr-icon-192.png"'],
  [/href="\/chat\/favicon\.png"/g, 'href="/chat/mr-favicon.png"'],
];
for (const [re, to] of map) html = html.replace(re, to);
writeFileSync(indexPath, html);
console.log('fixed chat/index.html icon links');
