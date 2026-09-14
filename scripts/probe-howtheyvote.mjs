#!/usr/bin/env node
/*
 * 18 April 2023, side by side, and where a chip could come from.
 *
 * The three rules, counted across seven sittings, corrected an earlier reading
 * of mine. decisionAboutId is not the broken rule: no ninth-term decision
 * carries the field at all, so it drops nothing there, and in the tenth term
 * it agrees with the label rule exactly — 5 and 5, 6 and 6, 6 and 6. The label
 * is doing all the work in both Parliaments.
 *
 *   date         portal   aboutId   label   |  them
 *   2020-02-12     49       49        9     |     7
 *   2021-03-09    130      130        0     |     0
 *   2023-04-18     16       16        4     |    10
 *   2024-10-22     10        5        5     |     5
 *   2025-04-01     35        6        6     |     7
 *   2025-09-09    107        6        6     |     6
 *   2024-11-13      2        2        2     |     0
 *
 * Which leaves one sitting that does not fit. Every one of the twelve dropped
 * on 18 April 2023 says "Am" and a number in its label, so by this project's
 * rule they are amendments — and they would be, were the rule right. They hold
 * ten. Two sittings differ by one the other way, and one by two. So the
 * remaining question is not "which rule" but "what is in their ten", and the
 * only way to answer it is to read their titles beside the portal's labels
 * rather than infer from counts.
 *
 * Second: a chip. Nothing on the portal names a EuroVoc concept — four
 * addresses tried, all empty — so "Gender equality" cannot be had from
 * europarl's own data, which is the constraint this project holds to. But a
 * report has a creator, and a report's creator is the committee that wrote it.
 * A committee is a subject a reader recognises, and it is the Parliament's own
 * word for one. So this asks what creator actually holds.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';

const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';

console.log('what the portal records on 2023-04-18');
const decisions = (await getAll('/meetings/MTG-PL-2023-04-18/decisions', {}, 500)).filter(isRollCall);
decisions.forEach(function (decision, index) {
  console.log(`  ${String(index + 1).padStart(2)}. ${english(decision.activity_label)}`);
});

console.log('\nwhat they list for the same day');
try {
  const response = await fetch('https://howtheyvote.eu/api/votes?date=2023-04-18',
    { headers: { accept: 'application/json', 'user-agent': AGENT } });
  const json = JSON.parse(await response.text());
  const rows = json.results || json.data || json.votes || (Array.isArray(json) ? json : []);
  console.log(`  total ${json.total !== undefined ? json.total : rows.length}, ${rows.length} rows returned`);
  rows.forEach(function (row, index) {
    const title = row.display_title || row.title || row.description || JSON.stringify(row).slice(0, 80);
    console.log(`  ${String(index + 1).padStart(2)}. ${String(title).slice(0, 96)}`);
    if (index === 0) console.log(`      fields: ${Object.keys(row).join(', ')}`);
  });
} catch (error) {
  console.log(`  could not read them: ${error.message}`);
}

console.log('\nwho creates a report?');
for (const id of ['A-9-2023-0056', 'A-9-2023-0066', 'A-9-2021-0018', 'A-9-2020-0002']) {
  const payload = await get(`/documents/${id}`, {});
  const row = (payload && payload.data && payload.data[0]) || null;
  if (!row) { console.log(`  ${id}: nothing`); continue; }
  console.log(`  ${id}  creator: ${JSON.stringify(row.creator).slice(0, 140)}`);
}

/* And whether a creator resolves to a name, the way a political group does. */
console.log('\ndoes a creator have a name?');
const sample = await get('/documents/A-9-2023-0056', {});
const row = (sample && sample.data && sample.data[0]) || {};
for (const uri of [].concat(row.creator || []).slice(0, 3)) {
  const id = String(typeof uri === 'string' ? uri : uri.id || '').split('/').pop();
  try {
    const answer = await get(`/corporate-bodies/${id}`, {});
    const body = (answer && answer.data && answer.data[0]) || null;
    console.log(`  ${id} -> ${body ? JSON.stringify(english(body.label)) : 'nothing'}`);
  } catch (error) {
    console.log(`  ${id} -> ${String(error.message).slice(0, 50)}`);
  }
}
