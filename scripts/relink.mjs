#!/usr/bin/env node
/*
 * Take the links that open an error page off the records.
 *
 *   node scripts/relink.mjs --dry-run
 *
 * Every vote carries a "Procedure file" link, and 1,715 of the 3,188 of them
 * answer Error 404 — a procedure number with its type missing (2019/0806) or a
 * joint motion (RC-B9-0006/2019), neither of which the Legislative Observatory
 * knows. Which shapes it does answer for was established by opening one of
 * each in a browser; see scripts/probe-reference-links.mjs.
 *
 * This site's claim is that its figures can be checked against the
 * Parliament's. More than half of its invitations to do that failed. A vote
 * whose reference OEIL cannot answer keeps the three links that work — the
 * roll-call annex, the minutes, and the sitting as data — and loses the fourth.
 *
 * Offline: it needs no portal, only the rule.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { opensOnOeil } from './lib/ep-sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';
const DRY = process.argv.includes('--dry-run');

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

let touched = 0;
let removed = 0;
let kept = 0;
for (const name of files) {
  const file = path.join(ROOT, DIR, name);
  const record = JSON.parse(await readFile(file, 'utf8'));
  const before = record.sources || [];
  const after = before.filter(function (source) {
    const match = /procedure-file\?reference=(.+)$/.exec(String(source.url || ''));
    if (!match) return true;
    const ok = opensOnOeil(decodeURIComponent(match[1]));
    if (ok) kept += 1; else removed += 1;
    return ok;
  });
  if (after.length === before.length) continue;
  record.sources = after;

  /* The procedure itself stays on the record — it is what the Parliament
     called this business, and the vote's page prints it. Only the link that
     promised a page and delivered an error is taken away. */
  if (record.procedure && record.procedure.url &&
      !opensOnOeil(record.procedure.reference)) {
    record.procedure = { reference: record.procedure.reference, url: null };
  }

  touched += 1;
  if (!DRY) await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
}

console.log(`${files.length} records: ${touched} changed, ${removed} dead links removed, ` +
  `${kept} working ones kept.`);
if (DRY) console.log('Dry run: nothing written.');
