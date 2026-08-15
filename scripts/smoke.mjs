import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173';

// Use a preinstalled browser when one is provided (CI images often ship a
// build that does not match the pinned Playwright version).
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
console.log('title:', await page.title());

// The catalog is fetched from the worker; if it never arrives the select stays empty.
await page.waitForFunction(
  () => document.querySelectorAll('#operation option').length > 5,
  { timeout: 15000 },
);
const opCount = await page.locator('#operation option').count();
console.log('operations in catalog:', opCount);

async function runExample(label, expectSubstring) {
  await page.getByRole('button', { name: label, exact: true }).click();
  // Analysis is debounced through the worker.
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Decipher' }).click();
  await page.waitForSelector('.result.top', { timeout: 30000 });
  const top = await page.locator('.result.top').first();
  const chain = (await top.locator('.chain').innerText()).trim();
  const output = (await top.locator('.output').innerText()).trim();
  const ok = output.includes(expectSubstring);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${label}] chain="${chain}" output="${output.slice(0, 60)}"`);
  return ok;
}

let pass = true;
pass = (await runExample('Base64', 'Meet me at the old bridge')) && pass;
pass = (await runExample('Base64 + ROT13', 'Meet me at the old bridge')) && pass;
pass = (await runExample('Vigenère', 'quick brown fox')) && pass;
pass = (await runExample('Nested (Base64 ×2 + ROT13)', 'Meet me at the old bridge')) && pass;
pass = (await runExample('Morse', 'HELLO THERE MY FRIEND')) && pass;
pass = (await runExample('Substitution', 'quick brown fox')) && pass;

// Analysis panel should have populated from the worker.
const stats = await page.locator('.stat .value').allInnerTexts();
console.log('analysis stats:', stats.join(' | '));

// Manual operation: Caesar with an explicit shift.
await page.locator('#operation').selectOption('caesar');
await page.locator('#param-shift').fill('13');
await page.getByRole('button', { name: 'Apply' }).click();
await page.waitForTimeout(800);
const manual = await page.locator('.panel', { hasText: 'Manual operation' }).locator('.output').first().innerText();
console.log('manual caesar output:', manual.slice(0, 50).replace(/\n/g, ' '));

await page.screenshot({ path: process.env.SHOT ?? 'ui.png', fullPage: true });
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();

if (!pass || errors.length) process.exit(1);
console.log('SMOKE OK');
