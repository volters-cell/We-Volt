#!/usr/bin/env node
/*
 * How much is a parliamentary term, before importing one?
 *
 *   node scripts/survey-term.mjs --from 2019-07-02 --until 2024-07-15
 *
 * Backfilling the ninth term is not a change to a filter: it is however many
 * thousand votes the Parliament took in five years, each one a file, each one
 * a preview card, on a site with a 1 GB ceiling and a ten-minute deploy
 * timeout. Guessing at that number and then discovering it would waste a
 * build; this asks the portal and reports it.
 *
 * It reads and counts. It writes no records.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { getAll, isRollCall, ballotsOf } from './lib/portal.mjs';
import { sittingDates, isFinalVote } from './fetch-plenary.mjs';

function arg(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at === -1 || !process.argv[at + 1] ? fallback : process.argv[at + 1];
}

const FROM = arg('from', '2019-07-02');
const UNTIL = arg('until', '2024-07-15');

console.log(`Walking ${FROM} to ${UNTIL}.\n`);
const dates = await sittingDates(FROM, UNTIL);
console.log(`${dates.length} sitting days.\n`);

const byYear = new Map();
let sittingsWithVotes = 0;
let decisionsSeen = 0;
let rollCalls = 0;
let finals = 0;
let ballotsTotal = 0;
let biggest = { date: null, ballots: 0 };

for (const date of dates) {
  const decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  if (!decisions.length) continue;
  sittingsWithVotes += 1;
  const year = date.slice(0, 4);
  const row = byYear.get(year) || { days: 0, rollCalls: 0, finals: 0 };

  let dayFinals = 0;
  for (const decision of decisions) {
    decisionsSeen += 1;
    if (!isRollCall(decision)) continue;
    rollCalls += 1;
    if (!isFinalVote(decision)) continue;
    finals += 1;
    dayFinals += 1;
    const n = ballotsOf(decision).length;
    ballotsTotal += n;
    if (n > biggest.ballots) biggest = { date: date, ballots: n };
  }
  row.days += 1;
  row.rollCalls += decisions.filter(isRollCall).length;
  row.finals += dayFinals;
  byYear.set(year, row);
  process.stdout.write(`  ${date}  ${String(decisions.length).padStart(4)} decisions, ` +
    `${String(dayFinals).padStart(3)} final roll-calls\n`);
}

console.log('\n' + '='.repeat(64));
console.log(`sitting days with votes   ${sittingsWithVotes}`);
console.log(`decisions of every kind   ${decisionsSeen}`);
console.log(`roll-call votes           ${rollCalls}`);
console.log(`final roll-call votes     ${finals}   <- what would be imported`);
console.log(`ballots cast across them  ${ballotsTotal.toLocaleString('en-GB')}`);
console.log(`most ballots in one vote  ${biggest.ballots} (${biggest.date})`);

console.log('\nby year');
for (const [year, row] of [...byYear].sort()) {
  console.log(`  ${year}  ${String(row.days).padStart(3)} days  ` +
    `${String(row.rollCalls).padStart(5)} roll-calls  ${String(row.finals).padStart(5)} final`);
}

/* What it would weigh. The tenth term's own records are the yardstick: its
   files average 25 KB and its preview cards 92 KB, both measured, and a
   ballot is a ballot whichever term cast it. */
const RECORD = 25764;
const CARD = 94639;
const PAGE = 5077;
const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
console.log('\nwhat it would add, at the tenth term\'s own measured sizes');
console.log(`  records in the repository   ${mb(finals * RECORD)}`);
console.log(`  preview cards at build time ${mb(finals * CARD)}`);
console.log(`  vote pages at build time    ${mb(finals * PAGE)}`);
console.log(`  uploaded to Pages, in total ${mb(finals * (RECORD + CARD + PAGE))}` +
  `  (on top of today's 103 MB, against a 1 GB ceiling)`);
console.log(`  og cards would take about   ${Math.round(finals * 48 / 718 / 60)} min to draw` +
  `  (against a 10 min deploy timeout)`);
