#!/usr/bin/env node
/*
 * Put the English title on votes that came out in another language.
 *
 *   node scripts/retitle.mjs --dry-run
 *   node scripts/retitle.mjs --from 2020-01-01 --until 2024-07-15
 *   node scripts/retitle.mjs --minutes 90
 *
 * A vote takes its title from the Parliament's vote item, which often carries
 * the short name in French alone — "Conclusion de l'accord de libre-échange
 * entre l'Union européenne et le Viêt Nam" — while the document behind it
 * carries a full one in English. The importer took the first title it found
 * rather than the best English one, and 1,088 votes of 3,570 ended up in a
 * language this site is not written in.
 *
 * So for those, and only those, the document is asked for its English title.
 * Nothing is translated and nothing is invented: a vote whose document has no
 * English title either keeps what the Parliament published, because a French
 * title is worth more than no title.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { documentTitle, documentPath } from './lib/portal.mjs';
import { looksEnglish, shorten, englishHalf } from './lib/titles.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
}
const FROM = arg('from');
const UNTIL = arg('until');

/* A thousand documents read one at a time can outlast the runner, and a run
   killed by the clock commits nothing at all — the work is done and thrown
   away. So the pass stops itself with time to spare and says what is left;
   run it again and it picks up the rest, because it only looks up titles
   that are still not English. */
const MINUTES = Number(arg('minutes') || 0);
const DEADLINE = MINUTES > 0 ? Date.now() + MINUTES * 60000 : Infinity;

/* A lookup that gives up, for the same reason the committee pass has one: a
   label is not worth stalling a run over. */
function within(promise, budget) {
  return Promise.race([promise,
    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, budget || 20000); })]);
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let looked = 0;
let rewritten = 0;
let trimmed = 0;
let stillOther = 0;
let leftForNextTime = 0;
let outOfTime = false;

for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));
  if (FROM && record.date < FROM) continue;
  if (UNTIL && record.date > UNTIL) continue;
  if (outOfTime) {
    if (!looksEnglish(String(record.title || ''))) leftForNextTime += 1;
    continue;
  }

  const before = String(record.title || '');
  let title = before;

  /* Free: the English is already in the title, beside the French and the
     German. No document to read and no portal to ask. */
  if (!looksEnglish(title)) {
    const half = englishHalf(title);
    if (half) title = half;
  }

  if (!looksEnglish(title)) {
    if (Date.now() > DEADLINE) { outOfTime = true; leftForNextTime += 1; continue; }
    const reference = record.document ||
      (record.procedure && documentPath(record.procedure.reference) ? record.procedure.reference : null);
    if (reference) {
      looked += 1;
      const english = await within(documentTitle(reference));
      if (english && looksEnglish(english)) title = english;
    }
    if (!looksEnglish(title)) stillOther += 1;
  }

  // Boilerplate comes off whatever language the title ended in.
  const short = shorten(title);
  if (short && short !== title) trimmed += 1;
  title = short || title;

  if (title === before) continue;
  record.title = title;
  rewritten += 1;
  if (looked % 25 === 0 && looked) console.log(`  ${rewritten} rewritten (${record.date})`);
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

console.log(`${files.length} records: ${looked} asked the portal for English, ` +
  `${rewritten} rewritten, ${trimmed} had boilerplate removed, ` +
  `${stillOther} the Parliament publishes in no English at all.`);
if (outOfTime) {
  console.log(`Stopped on the clock after ${MINUTES} minutes with ${leftForNextTime} ` +
    'records unread. What is written here is kept; run the pass again to go on.');
}
if (DRY) console.log('Dry run: nothing written.');
