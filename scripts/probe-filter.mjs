#!/usr/bin/env node
/*
 * Why does the amendment filter keep half of one term and a tenth of another?
 *
 *   node scripts/probe-filter.mjs --from 2025-01-01 --until 2025-12-31 --days 6
 *
 * isFinalVote drops a decision for one of two reasons: it carries
 * decisionAboutId, meaning the portal itself files it as being about another
 * decision, or its title matches "Am 16". The share kept fell from 52% in 2021
 * to 11% in 2025 while roll-call activity stayed level, which is either a
 * change in how the Parliament votes or a change in how the portal describes
 * it. This counts the two reasons separately and prints what is being dropped,
 * so the answer is read rather than argued about.
 *
 * Reads and counts. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { getAll, isRollCall, english } from './lib/portal.mjs';
import { sittingDates } from './fetch-plenary.mjs';

function arg(name, fallback) {
  const at = process.argv.indexOf('--' + name);
  return at === -1 || !process.argv[at + 1] ? fallback : process.argv[at + 1];
}

const FROM = arg('from', '2025-01-01');
const UNTIL = arg('until', '2025-12-31');
const DAYS = Number(arg('days', 6));
const AMENDMENT = /\b(am|amendement|amendment)s?\s*\d+/i;

const dates = await sittingDates(FROM, UNTIL);
/* Spread across the window rather than the first few days of it: a single
   plenary week is not a term. */
const step = Math.max(1, Math.floor(dates.length / DAYS));
const sample = dates.filter((_, i) => i % step === 0).slice(0, DAYS);
console.log(`${dates.length} sitting days in ${FROM}..${UNTIL}; sampling ${sample.length}: ${sample.join(', ')}\n`);

let rollCalls = 0, kept = 0, byId = 0, byTitle = 0, both = 0;
const examples = { byId: [], byTitle: [], kept: [] };

for (const date of sample) {
  const decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  for (const decision of decisions) {
    if (!isRollCall(decision)) continue;
    rollCalls += 1;
    const label = english(decision.activity_label).replace(/\s+/g, ' ').trim();
    const hasId = Boolean(decision.decisionAboutId);
    const looksAm = AMENDMENT.test(label);
    if (hasId && looksAm) both += 1;
    else if (hasId) byId += 1;
    else if (looksAm) byTitle += 1;
    else kept += 1;
    const bucket = hasId ? 'byId' : looksAm ? 'byTitle' : 'kept';
    if (examples[bucket].length < 6) {
      examples[bucket].push((hasId ? `[about ${decision.decisionAboutId}] ` : '') + label.slice(0, 96));
    }
  }
}

console.log('='.repeat(70));
console.log(`roll-call votes in the sample      ${rollCalls}`);
console.log(`  kept as a vote on the whole text ${kept}  (${(100 * kept / rollCalls).toFixed(0)}%)`);
console.log(`  dropped: carries decisionAboutId ${byId}  (${(100 * byId / rollCalls).toFixed(0)}%)`);
console.log(`  dropped: title says "Am N"       ${byTitle}  (${(100 * byTitle / rollCalls).toFixed(0)}%)`);
console.log(`  dropped: both reasons at once    ${both}  (${(100 * both / rollCalls).toFixed(0)}%)`);

for (const [name, list] of Object.entries(examples)) {
  console.log(`\n${name}:`);
  list.forEach((l) => console.log('   ' + l));
}
