#!/usr/bin/env node
/*
 * Put three of the Parliament's own sentences under every vote that has them.
 *
 *   node scripts/fetch-summaries.mjs --minutes 80
 *   node scripts/fetch-summaries.mjs --again      re-read records already done
 *
 * HowTheyVote writes three bullets under each title and asks its readers what
 * they think of them, because a machine wrote them. This site cannot do that:
 * it publishes what the Parliament published and nothing a reader cannot check
 * against it.
 *
 * The Parliament does write them, though, without meaning to. A motion for a
 * resolution is numbered operative paragraphs, each a whole sentence beginning
 * with a verb it chose — "Calls on Member States to maintain their ports open
 * to NGO vessels;". Three of those say what a vote was about and can be
 * checked word for word against the document they came from, which is linked
 * beside them.
 *
 * Nothing is written, paraphrased or condensed. A vote whose document has no
 * operative paragraphs — a legislative consent approves a text rather than
 * asking for anything — gets nothing, and shows nothing.
 *
 * www.europarl.europa.eu answers a plain HTTP client with an empty 202, so the
 * documents are opened in a browser. Run from Actions.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { documentPath } from './lib/portal.mjs';
import { bulletsFrom } from './lib/operative.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DOCEO = 'https://www.europarl.europa.eu/doceo/document/';

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
}
const AGAIN = process.argv.includes('--again');
const DRY = process.argv.includes('--dry-run');
const MINUTES = Number(arg('minutes') || 0);
const DEADLINE = MINUTES > 0 ? Date.now() + MINUTES * 60000 : Infinity;

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

// The wall, walked into once before anything is measured.
for (let i = 0; i < 3; i++) {
  try {
    await page.goto('https://www.europarl.europa.eu/portal/en', { waitUntil: 'domcontentloaded', timeout: 40000 });
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    if (text.replace(/\s/g, '').length > 500) break;
    await page.waitForTimeout(2500);
  } catch (error) { /* try again */ }
}

/* One document is read once, however many votes were taken on it — a plenary
   takes several votes on the same text and they would otherwise be fetched
   several times. */
const readAlready = new Map();

async function bulletsForDocument(reference) {
  const built = documentPath(reference);
  if (!built) return null;
  if (readAlready.has(built)) return readAlready.get(built);

  let bullets = null;
  try {
    const url = DOCEO + built + '_EN.html';
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (response && response.status() < 400) {
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      const found = bulletsFrom(text);
      if (found.length) bullets = { bullets: found, from: reference, url: url };
    }
  } catch (error) {
    bullets = null;
  }
  readAlready.set(built, bullets);
  return bullets;
}

let looked = 0;
let written = 0;
let nothingToQuote = 0;
let left = 0;
let outOfTime = false;

for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (!record.document) continue;
  if (!AGAIN && (record.whatItMeans || []).length) continue;
  if (outOfTime) { left += 1; continue; }
  if (Date.now() > DEADLINE) { outOfTime = true; left += 1; continue; }

  looked += 1;
  const found = await bulletsForDocument(record.document);
  if (!found) {
    nothingToQuote += 1;
    /* On a re-read, a record that used to carry boilerplate and now qualifies
       for nothing must lose it rather than keep what the rule has rejected. */
    if (AGAIN && (record.whatItMeans || []).length) {
      delete record.whatItMeans;
      delete record.whatItMeansFrom;
      if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
    }
    continue;
  }

  record.whatItMeans = found.bullets;
  record.whatItMeansFrom = { reference: found.from, url: found.url };
  written += 1;
  if (written % 25 === 0) console.log(`  ${written} written (${record.date})`);
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

await browser.close();
console.log(`${files.length} records: ${looked} documents opened, ${written} given the ` +
  `Parliament's own words, ${nothingToQuote} had no operative paragraph to quote.`);
if (outOfTime) {
  console.log(`Stopped on the clock after ${MINUTES} minutes with ${left} left. ` +
    'What is written here is kept; run it again to go on.');
}
if (DRY) console.log('Dry run: nothing written.');
