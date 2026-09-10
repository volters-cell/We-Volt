#!/usr/bin/env node
/*
 * Which address does the Parliament publish for ONE vote?
 *
 * Every record here cites the open data portal's front door, or at best the
 * JSON for a whole sitting. Neither is a citation a reader can follow: one
 * proves nothing, the other opens a wall of machine text. This asks the
 * Parliament's own servers which per-vote addresses actually resolve, so the
 * link put on 718 records is one that was tried rather than one that looked
 * plausible.
 *
 * www.europarl.europa.eu answers a plain HTTP client with an empty 202 — a
 * bot wall — so every candidate is opened in a real browser. The data portal
 * answers either way and is asked directly.
 *
 * Writes nothing. Run it from the Actions tab; read the table it prints.
 *
 *   node scripts/probe-vote-links.mjs
 */
import { chromium } from 'playwright';

const TERM = 10;

/* Three real votes, spread across the term, so a shape that only works for
   this month's sitting is caught here rather than after 718 files are written. */
const VOTES = [
  { id: 195719, date: '2026-07-09', procedure: '2023/0212(COD)', title: 'Establishment of the digital euro' },
  { id: 189599, date: '2026-03-26', procedure: '2023/0135(COD)', title: 'Combating corruption' },
  { id: 169401, date: '2024-09-16', procedure: null,             title: 'an early sitting of the term' }
];

function candidates(vote) {
  const d = vote.date;
  const p = vote.procedure;
  const doceo = 'https://www.europarl.europa.eu/doceo/document';
  const list = [
    ['minutes: table of contents', `${doceo}/PV-${TERM}-${d}-TOC_EN.html`],
    ['minutes: voting results',    `${doceo}/PV-${TERM}-${d}-VOT_EN.html`],
    ['roll-call annex (html)',     `${doceo}/PV-${TERM}-${d}-RCV_EN.html`],
    ['roll-call annex (xml)',      `${doceo}/PV-${TERM}-${d}-RCV_EN.xml`],
    ['sitting minutes (index)',    `https://www.europarl.europa.eu/doceo/document/PV-${TERM}-${d}-TOC_EN.html`],
    ['plenary votes search',       `https://www.europarl.europa.eu/plenary/en/votes.html?tab=votes`],
    ['portal: this decision',      `https://data.europarl.europa.eu/api/v2/decisions/${vote.id}?format=application%2Fld%2Bjson`],
    ['portal: decision (eli-dl)',  `https://data.europarl.europa.eu/eli/dl/dec/${d}-${vote.id}`],
    ['portal: sitting decisions',  `https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-${d}/decisions?format=application%2Fld%2Bjson`]
  ];
  if (p) {
    list.push(['OEIL procedure (new)', `https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=${p}`]);
    list.push(['OEIL procedure (old)', `https://oeil.europarl.europa.eu/oeil/popups/ficheprocedure.do?reference=${encodeURIComponent(p)}&l=en`]);
  }
  return list;
}

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

for (const vote of VOTES) {
  console.log('\n' + '='.repeat(78));
  console.log(`VOTE ${vote.id} — ${vote.date} — ${vote.title}`);
  console.log(`procedure: ${vote.procedure || '(none)'}`);
  console.log('='.repeat(78));

  for (const [name, url] of candidates(vote)) {
    let line = '  ' + name.padEnd(26);
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
      const status = response ? response.status() : 0;
      const type = ((response && response.headers()['content-type']) || '').split(';')[0];
      const body = await page.evaluate(() => document.body ? document.body.innerText : '');
      const title = (await page.title() || '').replace(/\s+/g, ' ').trim().slice(0, 54);

      // A bot wall answers 200 with nothing in it; a real page has text.
      const empty = body.replace(/\s/g, '').length < 200;
      // Does the page actually carry THIS vote, rather than merely existing?
      const names = String(vote.title).split(/\s+/).filter(w => w.length > 5).slice(0, 3);
      const mentions = names.length
        ? names.filter(w => body.toLowerCase().includes(w.toLowerCase())).length + '/' + names.length
        : '-';

      line += `${String(status).padEnd(4)} ${type.padEnd(24)} ` +
              `${String(body.replace(/\s/g, '').length).padStart(7)}ch  ` +
              `${empty ? 'EMPTY  ' : 'has text'}  words:${mentions}  id:${body.includes(String(vote.id)) ? 'yes' : 'no '}`;
      console.log(line);
      console.log('      ' + url);
      if (!empty) console.log('      title: ' + title);
    } catch (error) {
      console.log(line + 'FAILED  ' + String(error.message).split('\n')[0].slice(0, 60));
      console.log('      ' + url);
    }
  }
}

await browser.close();
