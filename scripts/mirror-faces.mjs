#!/usr/bin/env node
/*
 * Mirror the members' official portraits into the repository.
 *
 *   node scripts/mirror-faces.mjs            # everyone without a copy
 *   node scripts/mirror-faces.mjs --all      # fetch every portrait again
 *   node scripts/mirror-faces.mjs --probe    # try three and report, write none
 *
 * The Parliament publishes a portrait of every member at an address its own
 * record of that person gives. Asking for it with a plain HTTP client gets an
 * empty 202: europarl.europa.eu answers automated requests with a wall, not a
 * page. A browser is a different client — it negotiates the connection its own
 * way, carries the session the site sets, and asks the way a reader's browser
 * asks — so the fetch is made from inside a real Chromium, on the site's own
 * origin, and the bytes are carried back out.
 *
 * The copies live in assets/faces/. Serving them from here rather than
 * hot-linking is not only about the wall: a page that draws seven hundred
 * faces should not send seven hundred requests to somebody else's server, and
 * a portrait that is part of the record should not disappear when the source
 * reorganises its file names.
 *
 * © European Union. The Parliament's portraits are reusable under its reuse
 * notice with attribution, which the about page carries.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'assets/faces';
const HOME = 'https://www.europarl.europa.eu/meps/en/home';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('This needs playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const directory = JSON.parse(await readFile(path.join(ROOT, 'data/reference/meps.json'), 'utf8'));
const members = directory.members || {};
const ids = Object.keys(members);
if (!ids.length) {
  console.error('data/reference/meps.json is empty.');
  process.exit(1);
}

await mkdir(path.join(ROOT, OUT), { recursive: true });
const already = new Set(
  (await readdir(path.join(ROOT, OUT))).filter((n) => n.endsWith('.jpg')).map((n) => n.slice(0, -4))
);

const wanted = has('--probe')
  ? ids.slice(0, 3)
  : ids.filter((id) => has('--all') || !already.has(id));

console.log(`${wanted.length} portraits to fetch (${already.size} already here).`);
if (!wanted.length) process.exit(0);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: 'en-GB'
});
const page = await context.newPage();

/* One real visit first: the site sets what it sets, and the fetches that
   follow are made from inside that page, on that origin, with it. */
try {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log(`opened ${HOME} — ${await page.title()}`);
} catch (error) {
  console.warn(`could not open the members' page: ${error.message}`);
}

/* Fetched from inside the page, so it is the browser asking, and handed back
   as base64 because that is what survives the trip out of the tab. */
async function portrait(url) {
  return page.evaluate(async (address) => {
    try {
      const response = await fetch(address, { credentials: 'include' });
      if (!response.ok) return { status: response.status, body: null };
      const blob = await response.blob();
      if (!blob.size) return { status: response.status, body: null };
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
      return { status: response.status, type: blob.type, body: data };
    } catch (error) {
      return { status: 0, error: String(error && error.message), body: null };
    }
  }, url);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

let saved = 0;
let missing = 0;
let at = 0;

for (const id of wanted) {
  at += 1;
  const member = members[id];
  const url = member.photo || `https://www.europarl.europa.eu/mepphoto/${id}.jpg`;

  const answer = await portrait(url);
  const bytes = answer.body ? Buffer.from(answer.body, 'base64') : null;

  if (!bytes || bytes.length < 1024 || !bytes.subarray(0, 3).equals(JPEG)) {
    missing += 1;
    if (missing <= 5 || has('--probe')) {
      console.warn(`  ${id}: ${answer.status || 'no answer'} ` +
        `${answer.type || ''} ${bytes ? bytes.length + 'b' : 'empty'}`);
    }
    if (!has('--probe') && missing === 20 && saved === 0) {
      console.error('\nTwenty in a row with nothing behind them. The wall is up for this ' +
        'client too — stopping rather than writing a directory of nothing.');
      break;
    }
  } else {
    if (!has('--probe')) {
      await writeFile(path.join(ROOT, OUT, `${id}.jpg`), bytes);
    }
    saved += 1;
    if (has('--probe')) console.log(`  ${id}: ${answer.status} ${answer.type} ${bytes.length}b — a real photograph`);
  }

  if (at % 50 === 0) console.log(`  ${at}/${wanted.length} — ${saved} saved, ${missing} missing`);
  // Gentle: a portrait every fifth of a second, which is slower than a reader
  // scrolling a list of them.
  await page.waitForTimeout(180);
}

await browser.close();

if (has('--probe')) {
  console.log(`\nprobe: ${saved} of ${wanted.length} came back as photographs.`);
  process.exit(saved ? 0 : 1);
}

console.log(`\n${OUT}: ${saved} portraits written, ${missing} not available.`);
if (!saved) process.exit(1);
