#!/usr/bin/env node
/*
 * Put a label on every vote: the committee that wrote the text.
 *
 *   node scripts/fetch-topics.mjs --dry-run
 *   node scripts/fetch-topics.mjs
 *   node scripts/fetch-topics.mjs --again      # re-read records already done
 *
 * HowTheyVote puts a chip on every entry — Venezuela, Economy and budget,
 * Gender equality — drawn from EuroVoc, the EU's subject vocabulary. The
 * Parliament's portal carries those subjects on a document, as is_about, but
 * will not name one: every concept endpoint answers 404 and the API publishes
 * no vocabulary. This project takes its data from the Parliament and nowhere
 * else, so those particular words are not available to it.
 *
 * The committee is. It is on the document as creator, it was chosen by the
 * Parliament for this text, and it is a subject a reader knows how to read:
 * Environment, Foreign Affairs, Civil Liberties, Budgets. Across five sittings
 * spanning four years, 33 of 38 texts name one.
 *
 * A separate pass rather than part of the import, because the records are
 * already written and re-reading a whole term to add one field would be four
 * hours of somebody's afternoon for a field the portal will hand over in
 * minutes. Runs again safely: a record that has a committee is left alone
 * unless --again says otherwise.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get } from './lib/portal.mjs';
import { documentPath } from './lib/portal.mjs';
import { committeeOf, committeeName, committeeShort } from './lib/committees.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');
const AGAIN = process.argv.includes('--again');

/* One document is voted on several times across a term, and a term's worth of
   records asks for the same handful of files over and over. */
const seen = new Map();

async function committeeFor(reference) {
  const pathname = documentPath(reference);
  if (!pathname) return null;
  if (seen.has(pathname)) return seen.get(pathname);

  let code = null;
  try {
    const payload = await get(`/documents/${pathname}`, {});
    const row = (payload && payload.data && payload.data[0]) || null;
    code = row ? committeeOf(row.creator) : null;
  } catch (error) {
    code = null;
  }
  seen.set(pathname, code);
  return code;
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let labelled = 0;
let already = 0;
let noReference = 0;
let noCommittee = 0;
const tally = new Map();

for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));

  if (record.committee && !AGAIN) { already += 1; continue; }
  const reference = record.procedure && record.procedure.reference;
  if (!reference) { noReference += 1; continue; }

  const code = await committeeFor(reference);
  if (!code) { noCommittee += 1; continue; }

  record.committee = { code: code, label: committeeName(code), short: committeeShort(code) };
  tally.set(code, (tally.get(code) || 0) + 1);
  labelled += 1;
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

console.log(`${files.length} records: ${labelled} labelled` +
  (already ? `, ${already} already had one` : '') +
  `, ${noCommittee} whose document names no committee` +
  `, ${noReference} with no document at all.`);
[...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(function (entry) {
  console.log(`  ${entry[0].padEnd(6)} ${String(entry[1]).padStart(4)}  ${committeeName(entry[0])}`);
});
if (DRY) console.log('\nDry run: nothing written.');
