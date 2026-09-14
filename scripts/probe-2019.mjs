#!/usr/bin/env node
/*
 * Can the ninth term's first months be read at all?
 *
 * An earlier survey walked 2019 and found no sitting day carrying decisions,
 * and this project reported that the portal publishes none before 2020.
 * HowTheyVote lists votes from 18 July 2019, so either that report was wrong
 * or those votes come from somewhere else. This asks the portal several ways.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, isRollCall } from './lib/portal.mjs';

/* The dates HowTheyVote shows as its oldest, so the question is asked about
   days that certainly held votes. */
const DAYS = ['2019-07-18', '2019-09-18', '2019-09-19', '2019-10-10', '2019-11-14'];

console.log('does the meeting list know about 2019?');
for (const year of [2019, 2020]) {
  const meetings = await getAll('/meetings', { year: year }, 400);
  const plenary = meetings.filter((m) => !m.had_activity_type ||
    String(m.had_activity_type).indexOf('PLENARY') !== -1);
  const dates = plenary.map((m) => m.activity_date).filter(Boolean).sort();
  console.log(`  ${year}: ${meetings.length} meetings, ${plenary.length} plenary, ` +
    (dates.length ? `${dates[0]} .. ${dates[dates.length - 1]}` : 'no dates'));
}

console.log('\nand the days themselves?');
for (const date of DAYS) {
  const shapes = [
    ['decisions', `/meetings/MTG-PL-${date}/decisions`],
    ['vote-results', `/meetings/MTG-PL-${date}/vote-results`],
    ['the meeting', `/meetings/MTG-PL-${date}`]
  ];
  console.log(`\n  ${date}`);
  for (const [name, path] of shapes) {
    try {
      const rows = await getAll(path, {}, 500);
      const list = Array.isArray(rows) ? rows : [];
      const rollCalls = list.filter(isRollCall).length;
      console.log(`    ${name.padEnd(13)} ${list.length} row${list.length === 1 ? '' : 's'}` +
        (name === 'decisions' ? `, ${rollCalls} roll-call` : ''));
      if (list.length && name === 'decisions') {
        const first = list.find(isRollCall) || list[0];
        console.log(`      e.g. ${JSON.stringify(first.activity_label || first.id).slice(0, 90)}`);
      }
    } catch (error) {
      console.log(`    ${name.padEnd(13)} FAILED ${String(error.message).slice(0, 60)}`);
    }
  }
}
