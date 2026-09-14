#!/usr/bin/env node
/*
 * Is decisionAboutId the wrong rule?
 *
 * 18 April 2023 says it is. The portal records sixteen roll-calls, HowTheyVote
 * keeps ten, this project keeps four — and the six it throws away are texts,
 * not amendments:
 *
 *   dropped   Revision of the EU Emissions Trading System for aviation
 *             – A9-0155/2022 – Sunčana Glavak – Provisional agreement
 *   dropped   Machinery products – A9-0141/2022 – Ivan Štefanec – Provisional…
 *   dropped   Social Climate Fund – A9-0157/2022 – David Casa, Esther de Lange…
 *
 * Each was dropped for carrying decisionAboutId, which this project reads as
 * "this is an amendment to something". It is not: the portal sets it on a vote
 * on a provisional agreement too, which is the final vote on a file. The real
 * amendments that day say so in the label — "Am 680", "§ 29 – Am 6", "Recital
 * P – Am 2" — and the part filter already catches every one of them.
 *
 * Count the distinct texts in that sitting and the answer is ten, exactly what
 * HowTheyVote holds. On 12 February 2020 the same rule gives seven, exactly
 * what they hold. On 9 March 2021 it gives none, exactly what they hold,
 * because every roll-call that day amends a report whose final vote fell on
 * another day.
 *
 * So the label is the rule and decisionAboutId is noise. The danger in acting
 * on that is the tenth term, which has leaned on decisionAboutId since it was
 * written and whose labels carry subjects rather than markers. If dropping the
 * rule floods it with amendments, the rule is load-bearing there and the fix
 * has to be narrower. That is what this measures, against their count on the
 * same days rather than against an expectation.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';
import { isPartOfAText } from './lib/ep-sources.mjs';

const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';
const DAYS = ['2020-02-12', '2021-03-09', '2023-04-18',
  '2024-10-22', '2025-04-01', '2025-09-09', '2024-11-13'];

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

console.log('date         portal   aboutId   label   both   |  them');
for (const date of DAYS) {
  let decisions = [];
  try {
    decisions = (await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500)).filter(isRollCall);
  } catch (error) {
    console.log(`  ${date}  the portal would not answer`);
    continue;
  }
  // Three rules, side by side on the same sitting.
  const byAboutId = decisions.filter((d) => !d.decisionAboutId).length;
  const byLabel = decisions.filter((d) => !isPartOfAText(english(d.activity_label))).length;
  const byBoth = decisions.filter((d) => !d.decisionAboutId &&
    !isPartOfAText(english(d.activity_label))).length;
  const them = await theirs(date);
  console.log(`  ${date}  ${String(decisions.length).padStart(5)}   ` +
    `${String(byAboutId).padStart(6)}  ${String(byLabel).padStart(6)} ` +
    `${String(byBoth).padStart(6)}   |  ${them === null ? '   ?' : String(them).padStart(4)}`);
}

/* And a name for a concept, which nothing on the portal would give up. */
console.log('\nwhat names a EuroVoc concept?');
for (const shape of [
  '/documents/A-9-2023-0056?include=is_about',
  '/eurovoc-concepts/5420',
  '/subjects/5420',
  '/corporate-bodies/5420'
]) {
  try {
    const payload = await get(shape, {});
    const row = (payload && payload.data && payload.data[0]) || payload;
    if (!row) { console.log(`  ${shape.padEnd(42)} nothing`); continue; }
    console.log(`  ${shape.padEnd(42)} ${Object.keys(row).slice(0, 10).join(', ')}`);
  } catch (error) {
    console.log(`  ${shape.padEnd(42)} ${String(error.message).slice(0, 44)}`);
  }
}
