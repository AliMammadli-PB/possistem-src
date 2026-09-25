import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('market-pos/dist');
const outputDir = resolve(process.argv[2] || 'market-pos/release/visual-qa');
await mkdir(outputDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const requested = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = normalize(join(dist, relative));
    if (!file.startsWith(dist)) throw new Error('invalid path');
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Preview server failed');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
const results = {};
const capture = async (name) => {
  const output = join(outputDir, `${name}.png`);
  await page.screenshot({ path: output, fullPage: false });
  results[name] = await page.evaluate(() => ({
    viewport: [window.innerWidth, window.innerHeight],
    bodyOverflowX: document.body.scrollWidth > document.body.clientWidth,
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    bodySize: [document.body.scrollWidth, document.body.scrollHeight],
  }));
};
await capture('login-1024x768');
await page.getByRole('button', { name: /MarketPos Kassir/ }).click();
for (let index = 0; index < 4; index += 1) await page.getByRole('button', { name: '1 rəqəmi', exact: true }).click();
await page.getByRole('button', { name: /Daxil ol/ }).click();
await page.waitForTimeout(300);
await capture('dashboard-1024x768');
await page.locator('.rail nav button[title="Satış"]').click();
await page.waitForTimeout(700);
await capture('sale-1024x768');
results['sale-1024x768'] = {
  ...results['sale-1024x768'],
  ...await page.evaluate(() => ({
    visibleProducts: [...document.querySelectorAll('.product-card')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight; }).length,
    cartBottom: Math.round(document.querySelector('.checkout-actions')?.getBoundingClientRect().bottom || 0),
  })),
};
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
await capture('sale-1440x900');
const search = page.locator('.search-box input');
await search.fill('Coca-Cola');
await page.waitForTimeout(150);
await capture('coca-cola-1440x900');
results['coca-cola-1440x900'].products = await page.locator('.product-card').allTextContents();
await search.fill('Sirab');
await page.waitForTimeout(150);
await capture('sirab-1440x900');
results['sirab-1440x900'].products = await page.locator('.product-card').allTextContents();
console.log(JSON.stringify({ outputDir, results }, null, 2));
await browser.close();
await new Promise((done) => server.close(done));
