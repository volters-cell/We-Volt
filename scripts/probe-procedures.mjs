#!/usr/bin/env node
/*
 * Is there any English left for the 492 votes still titled in French?
 *
 * The retitle pass has taken the archive from 1,089 foreign titles to 492, and
 * then stopped, because it only knows how to read a document and these votes
 * have no document recorded. 372 of them carry a procedure reference instead —
 * "2019/2057", "2026/2746(RSP)" — and 117 carry nothing at all.
 *
 * So, before writing anything: does the portal answer for a procedure? Does
 * what it answers with name a document, or a title, and is any of it English?
 * And for the votes with nothing, does the sitting still hold an item whose
 * label carries English the importer did not take?
 *
 * Reads and prints. Writes nothing.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { get, english, englishOnly } from './lib/portal.mjs';
import { looksEnglish } from './lib/titles.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';

function shape(value) {
  if (!value) return '—';
  if (typeof value === 'string') return `(plain) ${value.slice(0, 70)}`;
  const keys = Object.keys(value);
  return `${keys.length} languages [${keys.slice(0, 10).join(' ')}]` +
    (value.en ? ` :: en = ${String(value.en).slice(0, 80)}` : ' :: NO ENGLISH');
}

async function tryGet(pathname, params) {
  try {
    const answer = await get(pathname, params || {});
    return answer && answer.data ? answer.data : answer;
  } catch (error) {
    return { error: String(error).slice(0, 110) };
  }
}

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((n) => n.endsWith('.json') && n !== 'index.json' && !/^term-\d+\.json$/.test(n));

const withProcedure = [];
const withNothing = [];
for (const name of files) {
  const record = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  if (looksEnglish(String(record.title || '')) || record.document) continue;
  const reference = record.procedure && record.procedure.reference;
  if (reference) withProcedure.push(record); else withNothing.push(record);
}
console.log(`${withProcedure.length} carry a procedure, ${withNothing.length} carry nothing.\n`);

/* Each shape of reference tried once: a bare number, a number with a type in
   brackets, and one of each year, because the portal has changed shape between
   terms before and a single sample would not show it. */
const seen = new Set();
const samples = [];
for (const record of withProcedure) {
  const reference = record.procedure.reference;
  const key = `${/\(/.test(reference) ? 'bracketed' : 'bare'}-${record.date.slice(0, 4)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  samples.push(record);
  if (samples.length >= 8) break;
}

for (const record of samples) {
  const reference = record.procedure.reference;
  console.log(`=== ${record.date}  ${reference}`);
  console.log(`    titled: ${String(record.title).slice(0, 90)}`);

  const direct = await tryGet(`/procedures/${encodeURIComponent(reference)}`);
  console.log(`    /procedures/${reference}: ${JSON.stringify(direct).slice(0, 200)}`);

  const searched = await tryGet('/documents', { 'work-type': null, procedure: reference, limit: 5 });
  console.log(`    /documents?procedure=: ${JSON.stringify(searched).slice(0, 200)}`);

  const asDocument = await tryGet('/documents', { 'procedure-reference': reference, limit: 5 });
  console.log(`    /documents?procedure-reference=: ${JSON.stringify(asDocument).slice(0, 200)}`);
  console.log('');
}

/* And the votes with no reference at all: is the English on the sitting? */
for (const record of withNothing.slice(0, 3)) {
  console.log(`=== ${record.date}  (no reference)  ${String(record.title).slice(0, 70)}`);
  const items = await tryGet(`/meetings/MTG-PL-${record.date}/vote-results`, { limit: 400 });
  const rows = Array.isArray(items) ? items : [];
  console.log(`    sitting holds ${rows.length} items`);
  const mine = rows.filter((row) => String(row.notation_votingId || '') === String(record.sourceId));
  console.log(`    matching this vote: ${mine.length}`);
  mine.slice(0, 1).forEach((row) => {
    console.log(`      activity_label:  ${shape(row.activity_label)}`);
    console.log(`      structuredLabel: ${shape(row.structuredLabel)}`);
    console.log(`      english():       ${String(english(row.activity_label)).slice(0, 80)}`);
    console.log(`      englishOnly():   ${String(englishOnly(row.activity_label)).slice(0, 80)}`);
    console.log(`      based_on:        ${JSON.stringify(row.based_on_a_realization_of || row.was_motivated_by || null).slice(0, 160)}`);
  });
  console.log('');
}
