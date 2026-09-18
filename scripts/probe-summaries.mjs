#!/usr/bin/env node
/*
 * Where can a short account of what a vote does come from, without inventing
 * one?
 *
 * HowTheyVote puts three bullets under every title — "Ban harmful addictive
 * practices", "An EU code of conduct for influencers" — and asks its readers
 * what they think of the summary, because a machine wrote it. This project
 * cannot do that: it publishes what the Parliament publishes, and nothing a
 * reader cannot check against it.
 *
 * Meanwhile this site's own summary field holds, on 603 records, a French
 * procedural label — "Proposition de résolution (ensemble du texte)" — printed
 * under an English title as though it said what the vote was about.
 *
 * So: does the Parliament write one itself? Two places it might.
 *
 *   1. The Legislative Observatory's procedure file. Its pages carry a summary
 *      of the adopted text written by Parliament staff, which would be exactly
 *      the thing — the Parliament's own prose, quotable and checkable.
 *   2. The document itself on doceo, whose motion for a resolution is numbered
 *      operative paragraphs: "calls on the Commission to…", "urges Member
 *      States to…". Quoting the first few is not a summary anyone wrote, but
 *      every word of it is the Parliament's.
 *
 * This opens both for real votes, prints the headings it finds and the first
 * of whatever text sits under them, and counts how much there is. It decides
 * nothing and writes nothing.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';

const CASES = [
  ['resolution (RSP)', 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2024/2721(RSP)'],
  ['legislative (COD)', 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2023/0212(COD)'],
  ['consent (NLE)', 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2018/0358(NLE)'],
  ['own-initiative (INI)', 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=2022/2051(INI)'],
  ['document: report', 'https://www.europarl.europa.eu/doceo/document/A-9-2020-0002_EN.html'],
  ['document: motion', 'https://www.europarl.europa.eu/doceo/document/B-9-2019-0154_EN.html']
];

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

console.log('warming up: europarl sets a cookie on first contact');
for (let i = 0; i < 3; i++) {
  try {
    await page.goto('https://www.europarl.europa.eu/portal/en', { waitUntil: 'domcontentloaded', timeout: 40000 });
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    if (text.replace(/\s/g, '').length > 500) break;
    await page.waitForTimeout(2500);
  } catch (error) { /* the wall; try again */ }
}

for (const [name, url] of CASES) {
  console.log('\n' + '='.repeat(78));
  console.log(name + '  —  ' + url);
  console.log('='.repeat(78));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const found = await page.evaluate(function () {
      const body = document.body ? document.body.innerText : '';

      // Every heading, so the shape of the page is visible rather than guessed.
      const headings = [];
      document.querySelectorAll('h1,h2,h3,h4').forEach(function (h) {
        const t = (h.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && headings.length < 22) headings.push(t.slice(0, 64));
      });

      /* A paragraph that reads like the Parliament deciding something. These
         are the verbs its resolutions are built from. */
      const operative = [];
      document.querySelectorAll('p, li, div').forEach(function (el) {
        if (el.children.length) return;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length < 60 || t.length > 400) return;
        if (!/^\d*\.?\s*(Calls on|Urges|Stresses|Notes|Welcomes|Considers|Recalls|Demands|Invites|Regrets|Underlines|Emphasises|Points out|Requests)\b/i.test(t)) return;
        if (operative.length < 6) operative.push(t.slice(0, 200));
      });

      // Anything the page itself calls a summary.
      let summary = '';
      const marker = body.search(/\bSummary\b/);
      if (marker !== -1) summary = body.slice(marker, marker + 700).replace(/\s+/g, ' ');

      return { chars: body.replace(/\s/g, '').length, headings: headings, operative: operative, summary: summary };
    });
    console.log('  text on the page: ' + found.chars + ' chars');
    console.log('  headings: ' + JSON.stringify(found.headings));
    console.log('  operative paragraphs found: ' + found.operative.length);
    found.operative.forEach(function (t) { console.log('    • ' + t); });
    console.log('  text under "Summary": ' + (found.summary ? found.summary.slice(0, 500) : '(no such word on the page)'));
  } catch (error) {
    console.log('  FAILED ' + String(error.message).split('\n')[0].slice(0, 70));
  }
}
await browser.close();
