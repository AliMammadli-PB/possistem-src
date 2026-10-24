#!/usr/bin/env node
/**
 * Print ChatGPT-ready prompts for hardware catalog images.
 * Usage: npm run hardware:prompts
 *        npm run hardware:prompts -- touch-pos
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'assets/hardware/image-prompts.json'), 'utf8'));
const filter = process.argv[2];

console.log('=== SYSTEM PROMPT (paste first in ChatGPT) ===\n');
console.log(data.chatgptSystemPrompt);
console.log('\n=== BATCH PROMPT (all products) ===\n');
console.log(data.chatgptBatchPrompt);

if (filter) {
  const product = data.products.find((p) => p.id === filter || p.filename === filter);
  if (!product) {
    console.error(`Unknown product: ${filter}`);
    process.exit(1);
  }
  console.log(`\n=== SINGLE: ${product.filename} ===\n`);
  console.log(`${product.prompt}. Transparent PNG background, no text, no logo.`);
} else {
  console.log('\n=== INDIVIDUAL PROMPTS ===\n');
  for (const product of data.products) {
    console.log(`--- ${product.filename} (${product.titleAz}) ---`);
    console.log(`${product.prompt}. Transparent PNG background, no text, no logo.\n`);
  }
}

console.log('Full guide: assets/hardware/CHATGPT-PROMPTS.md');
