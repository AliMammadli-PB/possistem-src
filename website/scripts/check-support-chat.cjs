const { chromium } = require('playwright-core');

const target = process.env.SUPPORT_CHAT_URL || 'http://127.0.0.1:3107';
const executablePath = process.env.CHROMIUM_PATH || '/home/panda/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.locator('.support-fab').waitFor({ state: 'visible' });
  await page.locator('.support-fab').click();

  const ask = async (question) => {
    const before = await page.locator('.support-msg.is-helper').count();
    await page.locator('#possistem-support-input').fill(question);
    await page.locator('.support-compose button[type="submit"]').click();
    await page.waitForFunction((count) => document.querySelectorAll('.support-msg.is-helper').length > count, before);
    return page.locator('.support-msg.is-helper').last();
  };

  const overview = await ask('salam demo ve anbar haqqinda melumat ver');
  const overviewText = await overview.innerText();
  assert(overviewText.includes('Demo Possistemi'), 'Combined demo and stock question did not return the overview.');
  assert(!overviewText.includes('məhsul tapılmadı'), 'Greeting was still treated as a product name.');
  assert(await overview.getByRole('button', { name: /Bəyəndim/ }).isVisible(), 'Helpful control is missing.');
  assert(await overview.getByRole('button', { name: /Bəyənmədim/ }).isVisible(), 'Not-helpful control is missing.');
  assert(await overview.getByRole('button', { name: /Report et/ }).isVisible(), 'Report control is missing.');

  await overview.getByRole('button', { name: /Bəyənmədim/ }).click();
  assert(await overview.locator('.support-report.is-embedded').isVisible(), 'Not-helpful did not open the report form.');
  await overview.getByRole('button', { name: /Bəyəndim/ }).click();
  assert(await overview.getByText('Təşəkkür edirik.').isVisible(), 'Helpful choice was not acknowledged.');

  const follow = await ask('problem var');
  const followText = await follow.innerText();
  assert(followText.includes('Əvvəl yazdığınız məsələni nəzərə alıram'), 'The follow-up did not use the previous stock context.');
  assert(await follow.getByRole('button', { name: /Report et/ }).isVisible(), 'Feedback controls are missing from a later reply.');

  console.log(JSON.stringify({ target, combinedReply: 'ok', feedback: 'ok', contextFollowUp: 'ok' }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
