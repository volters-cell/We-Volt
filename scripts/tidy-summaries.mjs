#!/usr/bin/env node
/*
 * Take the Parliament's procedural labels out of the summary.
 *
 *   node scripts/tidy-summaries.mjs --dry-run
 *
 * 603 votes carried, in the field the page prints under a vote's title as its
 * summary, a short label in French saying what was put to the vote:
 * "Proposition de résolution (ensemble du texte)", "Accord provisoire - Am 1",
 * "Projet de décision du Conseil". All 79 distinct values are labels of that
 * kind — the longest is 59 characters — and not one is a summary. An earlier
 * importer wrote them there.
 *
 * They are kept, because they are the Parliament's own record of what was
 * voted on: moved to votedOn, which nothing prints. And the summary is left
 * empty, which matters beyond the page — a record with a summary is treated as
 * carrying editorial work and is never deleted by a corrective rebuild, so
 * these 603 had been exempt from every rebuild since, protected by a label.
 *
 * Offline.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');

/* A procedural label is short and is not a sentence. Anything longer, or
   ending like prose, is left alone: that would be somebody's writing. */
function isLabel(text) {
  const value = String(text || '').trim();
  return value.length > 0 && value.length <= 80 && !/[.!?]$/.test(value);
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let moved = 0;
let left = 0;
for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));
  const summary = String(record.summary || '').trim();
  if (!summary) continue;
  if (!isLabel(summary)) { left += 1; continue; }
  record.votedOn = summary;
  record.summary = '';
  moved += 1;
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}
console.log(`${moved} procedural labels moved out of the summary; ${left} summaries left as written.`);
if (DRY) console.log('Dry run: nothing written.');
