#!/usr/bin/env node
/*
 * Remove the paragraph votes already imported.
 *
 *   node scripts/prune-part-votes.mjs --dry-run
 *   node scripts/prune-part-votes.mjs
 *
 * The importer now drops a vote on part of a text, but 7,558 ninth-term
 * records were fetched before it did, and 5,196 of them are paragraph votes:
 * "§ 22/1", "Recital K/2", "§ 13/6". They came in because the ninth term marks
 * a split only in the title, where the old rule was not looking.
 *
 * This deletes those records. A one-off: once run, the importer keeps them out.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isPartOfAText } from './lib/ep-sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let kept = 0;
const doomed = [];
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  if (isPartOfAText(record.title)) doomed.push({ name, title: record.title, date: record.date });
  else kept += 1;
}

console.log(`${files.length} records: ${kept} votes on a text, ${doomed.length} on part of one.`);
doomed.slice(0, 8).forEach((d) => console.log(`   ${d.date}  ${String(d.title).slice(0, 72)}`));
if (doomed.length > 8) console.log(`   … and ${doomed.length - 8} more`);

if (DRY) {
  console.log('\nDry run: nothing deleted.');
} else {
  for (const d of doomed) await unlink(path.join(ROOT, DIR, d.name));
  console.log(`\n${doomed.length} deleted. Run build-index.mjs and build-members.mjs next.`);
}
