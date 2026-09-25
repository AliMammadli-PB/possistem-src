import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const venue = process.env.WOLT_VENUE
  || 'https://wolt.com/az/aze/baku/venue/bravo-supermarket-narimanov-azinko';

/** [label, slug, max items] — high caps to collect venue catalog broadly */
const categories = [
  ['Meyvə və tərəvəz', 'meyv-v-trvzlr-9', 40],
  ['Yumurta', 'yumurtalar-13', 20],
  ['Çörək', 'corklr-v-un-mmulatlar-14', 30],
  ['Spirtsiz içki', 'spirtsiz-ickilr-17', 40],
  ['Təzə ət', 'tz-t-mhsullar-28', 25],
  ['Toyuq', 'toyuq-mhsullar-30', 20],
  ['Çay', 'caylar-31', 25],
  ['Dəniz məhsulları', 'dniz-mhsullar-v-his-verilmis-balqlar-36', 20],
  ['Qəhvə', 'qhv-v-kakaolar-37', 20],
  ['Yağ və sirkə', 'duru-yaglar-v-sirklr-44', 25],
  ['Süd məhsulları', 'sud-mhsullar-48', 40],
  ['Çips və çərəz', 'cips-crz-v-qlyanaltlar-60', 30],
  ['Sous və ədviyyat', 'sous-v-dviyyat-mhsullar-77', 25],
  ['Şirniyyat', 'sirniyyatlar-83', 30],
  ['Şirin ləzzətlər', 'sirin-lzztlr-93', 25],
  ['Delikates', 'delikates-mhsullar-96', 20],
  ['Makaron / düyü', 'makaron-duyu-v-bakliyyat-mhsullar-100', 30],
  ['Səhər yeməyi', 'shr-yemklri-104', 25],
  ['Hazır qidalar', 'hazr-qidalar-117', 20],
  ['Turşu', 'tursu-mhsullar-118', 15],
  ['Konservlər', 'konservlr-120', 25],
  ['Dondurulmuş', 'dondurulmus-mhsullar-126', 20],
  ['Şəkər / un', 'skr-v-un-mhsullar-133', 20],
  ['Kağız', 'kagz-mhsullar-137', 15],
  ['Yuyucu vasitələr', 'yuyucu-vasitlr-142', 25],
  ['Təmizlik', 'tmizlik-v-mist-mhsullar-148', 25],
];

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const debug = process.argv.includes('--debug');
const outputFile = valueAfter('--output');
const downloadDir = valueAfter('--download-dir');
const maxTotal = Number(valueAfter('--max') || 0) || Number.POSITIVE_INFINITY;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'az-AZ' });
const rows = [];

for (const [category, slug, wanted] of categories) {
  if (rows.length >= maxTotal) break;
  const url = `${venue}/items/${slug}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('[data-test-id="ItemCard"]').first().waitFor({ timeout: 25_000 });
  } catch (error) {
    console.error(`skip ${category}: ${error instanceof Error ? error.message : error}`);
    continue;
  }

  // Lazy-load more cards
  for (let scroll = 0; scroll < 8; scroll += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(350);
  }

  const cardLocator = page.locator('[data-test-id="ItemCard"]');
  const cards = await cardLocator.allInnerTexts();
  if (debug) {
    console.log(JSON.stringify({ category, count: cards.length, samples: cards.slice(0, 2) }, null, 2));
    continue;
  }

  let accepted = 0;
  const limit = Math.min(wanted, maxTotal - rows.length);
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex += 1) {
    if (accepted >= limit) break;
    const raw = cards[cardIndex] ?? '';
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const priceLine = lines.find((line) => /^~?AZN\s+\d+[.,]\d{2}/i.test(line));
    const priceIndex = priceLine ? lines.indexOf(priceLine) : -1;
    const name = priceIndex >= 0
      ? lines.slice(priceIndex + 1).find((line) =>
        !/^~?AZN\s+\d+[.,]\d{2}/i.test(line)
        && !/^(populyar|əlçatan deyil)$/i.test(line)
        && !/^~?\d+(?:[.,]\d+)?\s*(?:kg|kq|əd\.)$/i.test(line)
      ) ?? ''
      : '';
    if (!name || !priceLine || /campaign|kampaniya/i.test(name)) continue;

    const card = cardLocator.nth(cardIndex);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    const media = await card.evaluate((element) => {
      const images = Array.from(element.querySelectorAll('img')).map((image) => ({
        src: image.currentSrc || image.src || image.getAttribute('src') || '',
        alt: image.alt || '',
      })).filter((image) => /^https?:\/\//.test(image.src));
      const link = element.closest('a') || element.querySelector('a');
      return { imageUrl: images[0]?.src ?? '', imageAlt: images[0]?.alt ?? '', productUrl: link?.href ?? '' };
    });

    rows.push({
      category,
      name,
      priceMinor: Math.round(Number(priceLine.replace(/[^\d,.]/g, '').replace(',', '.')) * 100),
      sourceUrl: url,
      ...media,
    });
    accepted += 1;
  }
  console.error(`${category}: +${accepted} (total ${rows.length})`);
}

await browser.close();

if (downloadDir) {
  await fs.mkdir(downloadDir, { recursive: true });
  for (const [index, row] of rows.entries()) {
    if (!row.imageUrl) {
      console.error(`Missing image for ${row.name}`);
      continue;
    }
    const response = await fetch(row.imageUrl, { headers: { 'user-agent': 'MarketPos catalog reference collector' } });
    if (!response.ok) {
      console.error(`Image fail ${response.status}: ${row.name}`);
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `product-${String(index + 1).padStart(3, '0')}.png`;
    await sharp(buffer)
      .flatten({ background: '#ffffff' })
      .trim({ background: '#ffffff', threshold: 14 })
      .resize({ width: 640, height: 480, fit: 'contain', background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .toFile(path.join(downloadDir, fileName));
    row.assetPath = `./assets/wolt/${fileName}`;
  }
}

if (outputFile) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ count: rows.length, sample: rows.slice(0, 2) }, null, 2));
console.error(`Collected ${rows.length} product references.`);
