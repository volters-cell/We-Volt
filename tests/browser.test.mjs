#!/usr/bin/env node
/*
 * The site, in a browser, on both widths and both themes.
 *
 *   node tests/browser.test.mjs            (serves the checkout itself)
 *   BASE=http://localhost:8812 node tests/browser.test.mjs
 *
 * This lived in a scratch directory for months and was lost twice to a
 * restarted container, rewritten from memory both times. It belongs here: it
 * is the check that says whether the thing a reader opens actually works, and
 * it has already caught a 404 on the embed page that three passes of reading
 * the code did not.
 *
 * It needs Playwright. Where there is none it says so and exits 0, so that
 * running the test suite on a machine without a browser is not a failure.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (also) {
    console.log('browser.test.mjs: skipped — no Playwright here.');
    process.exit(0);
  }
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};

let base = process.env.BASE;
let server = null;
if (!base) {
  server = createServer(async function (request, response) {
    const asked = decodeURIComponent(request.url.split('?')[0]);
    const file = path.join(ROOT, asked.endsWith('/') ? asked + 'index.html' : asked);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  await new Promise(function (resolve) { server.listen(0, resolve); });
  base = 'http://localhost:' + server.address().port;
}

const problems = [];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(width, dark) {
  const page = await browser.newPage({ viewport: { width: width, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  page.on('pageerror', (e) => problems.push(`JS ERROR ${width}px: ${String(e).slice(0, 120)}`));
  page.on('console', (m) => {
    const text = m.text();
    // Google Fonts cannot be reached from a sandbox that intercepts TLS, and
    // the site does not load it any more; anything the site serves itself is
    // caught by the response listener below.
    if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(text)) {
      problems.push(`CONSOLE ${width}px: ${text.slice(0, 120)}`);
    }
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(base)) {
      problems.push(`HTTP ${r.status()}: ${r.url().replace(base, '')}`);
    }
  });
  return page;
}

for (const [width, dark] of [[390, false], [1280, true]]) {
  const label = width + (dark ? ' dark' : ' light');
  const page = await open(width, dark);
  await page.goto(base + '/index.html', { waitUntil: 'commit' });
  await page.waitForTimeout(6000);
  if (dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  if (await page.locator('.load-error').count()) problems.push(`${label}: load error shown`);

  // A plenary builds its cards when it opens, so open one.
  await page.locator('details.session summary').first().click().catch(() => {});
  await page.waitForTimeout(800);
  if (!(await page.locator('.decision-card').count())) problems.push(`${label}: opening a plenary showed no votes`);

  await page.locator('.decision-card').first().click().catch(() => {});
  await page.waitForTimeout(1400);
  const title = (await page.locator('#decision-title').textContent().catch(() => '')) || '';
  if (!title.trim()) problems.push(`${label}: opening a vote gave no title`);
  const roll = await page.locator('#roll-body .roll-row, #roll-body li, #roll-body tr').count();
  if (!roll) problems.push(`${label}: a vote opened with an empty roll-call`);

  // The map is filled from the stylesheet, so ask for the computed fill.
  const painted = await page.evaluate(() => [...document.querySelectorAll('#map path')]
    .filter((el) => { const f = getComputedStyle(el).fill; return f && f !== 'none'; }).length);
  if (painted < 20) problems.push(`${label}: map not painted (${painted} filled paths)`);

  await page.locator('#back-to-votes').click().catch(() => {});
  await page.waitForTimeout(600);

  await page.fill('#search-input', 'ukraine').catch(() => {});
  await page.locator('#search-go').click().catch(() => {});
  await page.waitForTimeout(1200);
  if (!(await page.locator('.decision-card').count())) problems.push(`${label}: search found nothing for ukraine`);

  await page.fill('#search-input', 'metsola').catch(() => {});
  await page.locator('#search-go').click().catch(() => {});
  await page.waitForTimeout(1200);
  if (!(await page.locator('.mep-hit').count())) problems.push(`${label}: no MEP result for "metsola"`);

  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (sideways) problems.push(`${label}: the page scrolls sideways`);
  await page.close();
}

for (const where of ['/about.html', '/404.html', '/embed.html']) {
  const page = await open(1000, false);
  const answer = await page.goto(base + where, { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  if (!answer || answer.status() >= 400) problems.push(`${where}: HTTP ${answer && answer.status()}`);
  await page.close();
}

await browser.close();
if (server) server.close();

if (problems.length) {
  console.log('browser.test.mjs: PROBLEMS');
  [...new Set(problems)].forEach((line) => console.log('  ' + line));
  process.exit(1);
}
console.log('browser.test.mjs: ok');
