#!/usr/bin/env node
/*
 * Delete imported votes in a date range, so they can be read again.
 *
 *   node scripts/forget-votes.mjs --from 2020-02-01 --until 2024-07-15 --dry-run
 *   node scripts/forget-votes.mjs --from 2020-02-01 --until 2024-07-15
 *
 * The importer is deliberately additive: it skips any vote whose sourceId it
 * already holds, so a backfill can be re-run after a failure without writing
 * anything twice. That is the right behaviour for filling a gap and the wrong
 * one for correcting a record, because a record already on file is never
 * revisited however wrong it is.
 *
 * Two things are wrong with the ninth term as imported. Its votes are titled
 * by their filing reference — "A9-0002/2020 - Geert Bourgeois - Consent
 * procedure" — because the importer could not reach the subject, and some
 * votes on part of a text were imported as whole ones because the timestamp
 * the Parliament appends to a label made the filter's patterns unmatchable.
 * Both are fixed in the importer, and neither fix reaches a record that
 * already exists.
 *
 * So this forgets them, and the backfill reads them again. Nothing is lost
 * that the portal cannot return: these records hold no editorial writing —
 * every summary in the range is empty — and anything that were hand-written
 * would have to be checked before a deletion like this, not after.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
}

const from = arg('from');
const until = arg('until');
const dry = process.argv.includes('--dry-run');

if (!from || !until) {
  console.error('Both --from and --until are required. This deletes records; ' +
    'it will not guess at which ones.');
  process.exit(1);
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

const doomed = [];
const written = [];
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  if (!record.date || record.date < from || record.date > until) continue;
  // A record carrying editorial writing is not the portal's to give back.
  if ((record.summary && record.summary.trim()) ||
      (record.whatItMeans && record.whatItMeans.length)) {
    written.push({ name: name, date: record.date, title: record.title });
    continue;
  }
  doomed.push({ name: name, date: record.date, title: record.title });
}

console.log(`${files.length} records on file, ${doomed.length} inside ${from} .. ${until}.`);
doomed.slice(0, 6).forEach((d) => console.log(`   ${d.date}  ${String(d.title).slice(0, 72)}`));
if (doomed.length > 6) console.log(`   … and ${doomed.length - 6} more`);

if (written.length) {
  console.log(`\n${written.length} kept: they carry writing the portal cannot return.`);
  written.slice(0, 10).forEach((w) => console.log(`   ${w.date}  ${String(w.title).slice(0, 72)}`));
}

if (dry) {
  console.log('\nDry run: nothing deleted.');
} else {
  for (const d of doomed) await unlink(path.join(ROOT, DIR, d.name));
  console.log(`\n${doomed.length} deleted. The backfill will read them again.`);
}
