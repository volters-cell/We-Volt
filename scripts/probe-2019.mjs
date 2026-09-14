#!/usr/bin/env node
/*
 * The ninth term's first months are readable after all.
 *
 * An earlier run of this probe settled that: 18 July 2019 answers with nine
 * roll-call decisions, and every other day asked about answered too. What it
 * also showed is why this project had reported the opposite — the meeting list
 * for 2019 returns 52 plenary meetings and not one of them carries an
 * activity_date, and both fetchers drop a meeting with no date. The days were
 * always there; the index that points at them is what is missing.
 *
 * So this asks what a 2019 meeting row does carry, and whether the sitting
 * days can be recovered from it.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { getAll, isRollCall } from './lib/portal.mjs';

const DATE = /(\d{4})-(\d{2})-(\d{2})/;

console.log('what does a 2019 meeting row look like?');
const meetings = await getAll('/meetings', { year: 2019 }, 400);
console.log(`  ${meetings.length} rows`);
for (const row of meetings.slice(0, 2)) {
  console.log(`  keys: ${Object.keys(row).join(', ')}`);
  console.log(`  ${JSON.stringify(row).slice(0, 600)}`);
}

/* If the identifier names the day, the sitting days are recoverable without
   the field that is missing. */
const dated = meetings
  .map((row) => ({ row: row, date: (DATE.exec(String(row.id || '')) || [])[0] }))
  .filter((entry) => entry.date);
const days = [...new Set(dated.map((entry) => entry.date))].sort();
console.log(`\n  ${days.length} of ${meetings.length} rows name a day in their id`);
if (days.length) console.log(`  ${days[0]} .. ${days[days.length - 1]}`);

/* And compare with 2020, where the field is present, to be sure the id is not
   telling a different story from activity_date where both exist. */
const twenty = await getAll('/meetings', { year: 2020 }, 400);
const disagreeing = twenty.filter(function (row) {
  const fromId = (DATE.exec(String(row.id || '')) || [])[0];
  return row.activity_date && fromId && fromId !== row.activity_date;
});
console.log(`  2020: ${twenty.length} rows, ${disagreeing.length} where the id and the date disagree`);

/* Then the real question: how many roll-call votes does the whole of the
   ninth term's 2019 hold? */
console.log('\nhow much is there, in 2019?');
let total = 0;
let sat = 0;
for (const date of days.filter((day) => day >= '2019-07-02')) {
  let rows = [];
  try {
    rows = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  } catch (error) {
    console.log(`  ${date}  FAILED ${String(error.message).slice(0, 50)}`);
    continue;
  }
  const rollCalls = (Array.isArray(rows) ? rows : []).filter(isRollCall).length;
  if (rollCalls) sat += 1;
  total += rollCalls;
  console.log(`  ${date}  ${String(rollCalls).padStart(4)} roll-call`);
}
console.log(`\n  ${total} roll-call decisions across ${sat} sitting days in 2019`);
