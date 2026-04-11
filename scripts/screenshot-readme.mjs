#!/usr/bin/env node
/**
 * One-shot script to capture README screenshots from a running dev server.
 * Usage: BASE_URL=http://localhost:3000 node scripts/screenshot-readme.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();

async function shot(name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
  console.log('saved', name);
}

// 1. Editor view — open a file and the structure pane
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[role="treeitem"]');

// Expand all collapsed folders
for (const el of await page.$$('[role="treeitem"][aria-expanded="false"]')) {
  await el.click();
}

// Open the from-template.yml file
const items = await page.$$('[role="treeitem"]');
for (const it of items) {
  const txt = (await it.textContent()) ?? '';
  if (txt.trim() === 'from-template.yml') {
    await it.click();
    await it.dblclick();
    break;
  }
}

// Expand structure pane
const expand = await page.$('button[aria-label="Expand structure panel"]');
if (expand) await expand.click();

// Wait for the Monaco editor to fully render its content (look for a
// .view-line with our seed YAML in it).
await page.waitForFunction(
  () => {
    const lines = document.querySelectorAll('.view-line');
    return lines.length > 0 && [...lines].some((l) => /http|router|service/i.test(l.textContent ?? ''));
  },
  { timeout: 15_000 },
).catch(() => {});

await page.waitForTimeout(500);
await page.mouse.move(0, 0);
await shot('editor');

// 2. Traefik status page
await page.goto(`${BASE}/traefik`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.mouse.move(720, 500);
await shot('traefik');

// 3. Settings page
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.mouse.move(720, 500);
await shot('settings');

await browser.close();
