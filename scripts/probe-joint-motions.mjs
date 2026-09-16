#!/usr/bin/env node
/*
 * Two questions the procedure probe left open.
 *
 * It established that there is no procedure route: /procedures/2018/0356
 * answers 400, and /documents?procedure= and ?procedure-reference= ignore the
 * filter entirely — three different references returned the same first page of
 * every document the portal has. So the 372 votes carrying a procedure number
 * cannot be resolved that way.
 *
 * What is left is the fifty-eight votes titled by a filing reference —
 * "RC-B9-0102/2020 - Am 4". The pass looks those up and gets nothing back, in
 * under a second, which is not what a real lookup looks like. So: what does
 * the portal say about RC-B-9-2020-0102, and is that even the right shape for
 * a joint motion?
 *
 * And the sitting: matching a vote to its item by notation_votingId found 0 of
 * 76 items. Either the key is wrong or the item is not published. This prints
 * the keys both sides actually carry, rather than guessing which.
 *
 * Reads and prints. Writes nothing.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { get, getAll, english, englishOnly, documentPath, lastSegment } from './lib/portal.mjs';
import { looksEnglish } from './lib/titles.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';

async function tryGet(pathname, params) {
  try {
    return await get(pathname, params || {});
  } catch (error) {
    return { error: String(error).slice(0, 120) };
  }
}

function titleOf(row) {
  if (!row) return '—';
  const value = row.title_dcterms || row.title || null;
  if (!value) return 'NO TITLE FIELD: ' + Object.keys(row).slice(0, 14).join(' ');
  if (typeof value === 'string') return `(plain) ${value.slice(0, 90)}`;
  return `[${Object.keys(value).join(' ')}]` +
    (value.en ? ` :: en = ${String(value.en).slice(0, 80)}` : ' :: NO ENGLISH');
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

const filing = [];
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  const title = String(record.title || '');
  if (looksEnglish(title) || record.document) continue;
  const match = /([A-Z]+(?:-[A-Z]+)?\d{1,2}-\d{4}\/\d{4})/.exec(title);
  if (match) filing.push({ record, code: match[1] });
}
console.log(`${filing.length} votes titled by a filing reference.\n`);

for (const { record, code } of filing.slice(0, 4)) {
  const built = documentPath(code);
  console.log(`=== ${record.date}  ${code}  ->  ${built}`);
  console.log(`    titled: ${String(record.title).slice(0, 80)}`);

  const direct = await tryGet(`/documents/${built}`);
  const row = direct && direct.data && direct.data[0];
  console.log(`    /documents/${built}: ${direct.error || (row ? titleOf(row) : JSON.stringify(direct).slice(0, 150))}`);

  /* The same reference the other way round, in case a joint motion is filed
     under its year first like a report is, or not hyphenated at all. */
  for (const shape of [built.replace(/^RC-/, ''), code.replace(/[/]/g, '-'), `RC-B-9-${code.slice(-4)}-${/(\d{4})\//.exec(code)[1]}`]) {
    const other = await tryGet(`/documents/${shape}`);
    const found = other && other.data && other.data[0];
    console.log(`      as ${shape}: ${other.error ? 'error' : (found ? titleOf(found) : 'empty')}`);
  }
  console.log('');
}

/* And the sitting, with both sides' keys printed rather than assumed. */
const day = filing.length ? filing[0].record.date : '2020-05-13';
const sample = filing.length ? filing[0].record : null;
console.log(`=== sitting ${day}`);
const items = await getAll(`/meetings/MTG-PL-${day}/vote-results`, {}, 500);
console.log(`    ${items.length} items published`);
if (sample) console.log(`    this vote's sourceId: ${sample.sourceId}`);
items.slice(0, 5).forEach((item) => {
  console.log(`      keys: ${Object.keys(item).slice(0, 12).join(' ')}`);
  console.log(`      notation_votingId=${item.notation_votingId} activity_id=${lastSegment(String(item.activity_id || item.id || ''))}`);
  console.log(`      label en: ${String(englishOnly(item.activity_label) || '(none)').slice(0, 70)} | any: ${String(english(item.activity_label)).slice(0, 60)}`);
});
