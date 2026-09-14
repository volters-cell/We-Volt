#!/usr/bin/env node
/*
 * Does one-card-per-text land where HowTheyVote lands?
 *
 * Their list for 18 April 2023 is ten entries, and the portal's sixteen
 * roll-calls that day cover exactly those ten texts — the Emissions Trading
 * System twice over, machinery products, the Social Climate Fund, sustainable
 * carbon cycles, each voted on several times. Their API says as much in its
 * own fields: is_main, amendment_subject, amendment_number. They count texts.
 * This project counted ballots, and then threw away every text whose only
 * roll-call that day was an amendment, which is how sixteen became four.
 *
 * The importer now collapses a sitting's roll-calls into one record per text,
 * built from the vote on the whole where there was one and otherwise from the
 * last roll-call taken on it. This checks that against their count on seven
 * sittings across both Parliaments — the same seven as before, so the numbers
 * can be set beside the old ones.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { sittingVotes } from './fetch-plenary.mjs';

const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';
const DAYS = ['2020-02-12', '2021-03-09', '2023-04-18',
  '2024-10-22', '2025-04-01', '2025-09-09', '2024-11-13'];
const WAS = { '2020-02-12': 9, '2021-03-09': 0, '2023-04-18': 4,
  '2024-10-22': 5, '2025-04-01': 6, '2025-09-09': 6, '2024-11-13': 2 };

async function theirs(date) {
  try {
    const response = await fetch(`https://howtheyvote.eu/api/votes?date=${date}`,
      { headers: { accept: 'application/json', 'user-agent': AGENT } });
    if (!response.ok) return null;
    const json = JSON.parse(await response.text());
    const rows = json.results || json.data || json.votes || (Array.isArray(json) ? json : []);
    return json.total !== undefined ? json.total : rows.length;
  } catch (error) {
    return null;
  }
}

console.log('date          roll-calls   texts   was   |  them');
let agree = 0;
for (const date of DAYS) {
  const votes = await sittingVotes(date);
  if (!votes) { console.log(`  ${date}  nothing`); continue; }
  const ballots = votes.reduce(function (sum, vote) { return sum + (vote.rollCalls || 1); }, 0);
  const them = await theirs(date);
  if (them === votes.length) agree += 1;
  console.log(`  ${date}   ${String(ballots).padStart(8)}  ${String(votes.length).padStart(6)} ` +
    ` ${String(WAS[date]).padStart(4)}   |  ${them === null ? '   ?' : String(them).padStart(4)}` +
    (them === votes.length ? '   =' : ''));
}
console.log(`\n${agree} of ${DAYS.length} sittings now agree exactly.`);

console.log('\nand what 18 April 2023 is called now');
for (const vote of await sittingVotes('2023-04-18')) {
  console.log(`  ${String(vote.rollCalls).padStart(2)} roll-call  ${(vote.subject || vote.label).slice(0, 84)}`);
}
