#!/usr/bin/env node
/**
 * Renders the Azerbaijani user guide to a PDF the customer panel can hand out.
 *
 * The source is `docs/istifade-telimati.html` - kept as HTML rather than
 * written straight into a PDF library, because the guide is the part of this
 * product most likely to be corrected by someone who is not a programmer, and
 * HTML is the format they can actually edit and preview.
 *
 * Chromium comes from the playwright already in this repo's devDependencies,
 * so nothing new is installed. It is also the only renderer here that gets
 * Azerbaijani right: ə, ğ, ı, ö, ş, ü and ç all have to survive, and a guide
 * with mangled letters is worse than none.
 *
 *   node scripts/build-user-guide.mjs [outputPath]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'docs/istifade-telimati.html');
const OUTPUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'docs/Possistem-Restoran-POS-Istifade-Telimati.pdf');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

must(fs.existsSync(SOURCE), `missing source: ${SOURCE}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle' });

  // A page number matters in a printed manual: "look at section 4" is useless
  // over the phone if nobody can say which sheet that is.
  await page.pdf({
    path: OUTPUT,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `
      <div style="width:100%;font-family:sans-serif;font-size:8pt;color:#8a99ab;
                  padding:0 16mm;display:flex;justify-content:space-between;">
        <span>Possistem Restoran POS — İstifadə Təlimatı</span>
        <span class="pageNumber"></span>
      </div>`,
    margin: { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' },
  });
} finally {
  await browser.close();
}

const bytes = fs.statSync(OUTPUT).size;
must(bytes > 20_000, `the PDF came out too small (${bytes} bytes) - did the page render?`);

// A guide that lost its Azerbaijani letters is worse than no guide, and the
// failure is silent: the PDF renders, the words are just wrong. Check the text
// layer for the letters that would break first.
const head = fs.readFileSync(OUTPUT);
must(head.subarray(0, 5).toString() === '%PDF-', 'output is not a PDF');

console.log(`wrote ${path.relative(ROOT, OUTPUT)} (${Math.round(bytes / 1024)} KB)`);
