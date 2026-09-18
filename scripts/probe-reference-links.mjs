#!/usr/bin/env node
/*
 * Do the "Procedure file" links actually open a procedure file?
 *
 * Every vote cites one, and 1,090 of the 3,176 cite it with a document code
 * rather than a procedure reference:
 *
 *   https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=RC-B9-0006/2019
 *
 * RC-B9-0006/2019 is a joint motion for a resolution — a document. A procedure
 * reference looks like 2019/2820(RSP). OEIL's procedure-file takes the second
 * and, on the face of it, cannot answer for the first. A further 1,485 cite a
 * bare 2019/0806, a procedure number with its type missing, which may or may
 * not resolve.
 *
 * This site's whole claim is that its figures can be checked against the
 * Parliament's. A citation that opens nothing is worse than no citation: it
 * invites the check and then fails it.
 *
 * So, before changing 3,740 records: open each shape in a real browser and see
 * what comes back. www.europarl.europa.eu answers a plain client with an empty
 * 202 — a bot wall — which an earlier probe here mistook for "does not exist",
 * so the wall is walked into once before anything is measured.
 *
 * Also tried: the document's own page on doceo, which is where a document code
 * should point if the procedure file cannot take it.
 *
 * Writes nothing. Run it from the Actions tab and read the table.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';
import { documentPath } from './lib/portal.mjs';

const OEIL = 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=';
const DOCEO = 'https://www.europarl.europa.eu/doceo/document/';

/* One of each shape found in the records, named by what it is. */
const CASES = [
  ['procedure, with type',    OEIL + '2024/2721(RSP)'],
  ['procedure, with type',    OEIL + '2023/0212(COD)'],
  ['procedure, bare number',  OEIL + '2019/0806'],
  ['procedure, bare number',  OEIL + '2019/2057'],
  ['document code (report)',  OEIL + 'A9-0002/2020'],
  ['document code (joint)',   OEIL + 'RC-B9-0006/2019'],
  ['document code (council)', OEIL + 'C9-0161/2020'],
  ['document on doceo',       DOCEO + documentPath('A9-0002/2020') + '_EN.html'],
  ['document on doceo',       DOCEO + documentPath('RC-B9-0006/2019') + '_EN.html'],
  ['document on doceo',       DOCEO + documentPath('B9-0154/2019') + '_EN.html'],
  ['roll-call annex',         DOCEO + 'PV-9-2019-07-15-RCV_EN.html'],
  ['sitting minutes',         DOCEO + 'PV-9-2019-07-15-TOC_EN.html']
];

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

console.log('warming up: europarl.europa.eu sets its cookie on first contact');
for (let i = 0; i < 3; i++) {
  try {
    const r = await page.goto('https://www.europarl.europa.eu/portal/en',
      { waitUntil: 'domcontentloaded', timeout: 40000 });
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    console.log(`  attempt ${i + 1}: ${r ? r.status() : '?'}, ${text.replace(/\s/g, '').length} chars`);
    if (text.replace(/\s/g, '').length > 500) break;
    await page.waitForTimeout(2500);
  } catch (error) {
    console.log(`  attempt ${i + 1}: ${String(error.message).split('\n')[0].slice(0, 50)}`);
  }
}

/* "It answered 200" is not the question. OEIL answers 200 for a reference it
   has nothing for, with a page that says so — so the page's own words decide. */
const NOTHING = /no result|not found|aucun r|no procedure|does not exist|error/i;

console.log('\n' + 'shape'.padEnd(26) + 'status  chars   verdict');
console.log('-'.repeat(78));
for (const [name, url] of CASES) {
  try {
    let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    if (response && response.status() === 202 && body.replace(/\s/g, '').length < 200) {
      await page.waitForTimeout(3000);
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      body = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    }
    const status = response ? response.status() : 0;
    const chars = body.replace(/\s/g, '').length;
    const title = ((await page.title()) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const empty = chars < 200;
    const says = NOTHING.test(body.slice(0, 3000));
    const verdict = status >= 400 ? 'HTTP ' + status
      : empty ? 'EMPTY — nothing served'
      : says ? 'ANSWERS "nothing found"'
      : 'opens a page';
    console.log(name.padEnd(26) + String(status).padEnd(8) + String(chars).padStart(6) + '  ' + verdict);
    console.log('   ' + url);
    if (!empty) console.log('   title: ' + title);
  } catch (error) {
    console.log(name.padEnd(26) + 'FAILED  ' + String(error.message).split('\n')[0].slice(0, 50));
    console.log('   ' + url);
  }
}
await browser.close();
