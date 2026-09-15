#!/usr/bin/env node
/*
 * Put what a vote is about on every vote.
 *
 *   node scripts/tag-topics.mjs --dry-run
 *   node scripts/tag-topics.mjs
 *
 * Reads nothing from the network. The subject is in the title the Parliament
 * gave the text — "Russia's war of aggression against Ukraine", "European
 * Border and Coast Guard Agency" — so it can be read off the records already
 * on file, in seconds, for every vote of both Parliaments at once.
 *
 * That matters beyond speed. The committee route needs one request per report
 * and the portal has been refusing most of them, which turned a label into an
 * hour-long job that finished with nothing to show. This needs no portal at
 * all, so it cannot half-finish and cannot be undone by a bad afternoon.
 *
 * Every run re-reads every title rather than skipping records already tagged:
 * when a word is added to the vocabulary, the votes that word describes should
 * gain it, and a pass that only filled in blanks would leave them behind.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { topicsFor } from './lib/topics.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let tagged = 0;
let changed = 0;
const tally = new Map();

for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));
  const topics = topicsFor(record.title);

  const before = JSON.stringify(record.topics || []);
  if (topics.length) {
    tagged += 1;
    topics.forEach(function (topic) { tally.set(topic, (tally.get(topic) || 0) + 1); });
  }
  if (before === JSON.stringify(topics)) continue;

  record.topics = topics;
  changed += 1;
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

console.log(`${files.length} records: ${tagged} carry a topic ` +
  `(${Math.round((tagged / files.length) * 100)}%), ${changed} rewritten.`);
[...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).forEach(function (entry) {
  console.log(`  ${String(entry[1]).padStart(4)}  ${entry[0]}`);
});
if (DRY) console.log('\nDry run: nothing written.');
