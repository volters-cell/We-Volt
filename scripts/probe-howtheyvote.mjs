#!/usr/bin/env node
/*
 * Why does this site hold more votes for a sitting than HowTheyVote does, and
 * where would a vote's topic come from?
 *
 * Their list for 18 July 2019 shows one entry, "The situation in Venezuela".
 * The Parliament's portal records nine roll-call decisions that day. For 19
 * September 2019 they show a handful where the portal records sixteen. So they
 * are keeping one vote per text and this project is keeping several, or they
 * are keeping only some texts — and the difference has to be measured on the
 * same days rather than reasoned about.
 *
 * Their entries also carry a topic — Venezuela, Economy and budget, Gender
 * equality — which this site has nothing like. That has to come from the
 * Parliament's own data, not from theirs, so the second half of this asks the
 * portal whether a document or a procedure carries subject concepts.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';

const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';
const DAYS = ['2019-07-18', '2019-09-19', '2020-02-12', '2021-03-09', '2023-04-18'];

async function theirs(date) {
  const shapes = [
    `https://howtheyvote.eu/api/votes?date=${date}`,
    `https://api.howtheyvote.eu/api/votes?date=${date}`,
    `https://howtheyvote.eu/votes?date=${date}`
  ];
  for (const url of shapes) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json,text/html', 'user-agent': AGENT },
        redirect: 'follow'
      });
      if (!response.ok) continue;
      const body = await response.text();
      let count = null;
      try {
        const json = JSON.parse(body);
        const rows = json.results || json.data || json.votes || (Array.isArray(json) ? json : null);
        if (rows) count = rows.length;
        if (json.total !== undefined) count = json.total;
      } catch (error) {
        // An HTML page still says how many cards it drew.
        const cards = body.match(/\/votes\/\d+/g);
        if (cards) count = new Set(cards).size;
      }
      return { url: url, status: response.status, count: count, bytes: body.length };
    } catch (error) {
      // try the next shape
    }
  }
  return null;
}

console.log('the same days, both ways');
for (const date of DAYS) {
  let decisions = [];
  try {
    decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  } catch (error) {
    console.log(`  ${date}  the portal would not answer: ${error.message}`);
    continue;
  }
  const rollCalls = decisions.filter(isRollCall);
  const theirRow = await theirs(date);
  console.log(`  ${date}  portal ${String(rollCalls.length).padStart(4)} roll-call  |  ` +
    (theirRow
      ? `them ${String(theirRow.count).padStart(4)}  (${theirRow.status} from ${theirRow.url.replace('https://', '')})`
      : 'them: no address answered'));
}

/* And where a topic could come from. A vote names its report; the report may
   carry the Parliament's own subject concepts. */
console.log('\ndoes a document carry subject concepts?');
for (const id of ['A-9-2020-0002', 'A-9-2021-0018', 'A-9-2023-0056']) {
  const payload = await get(`/documents/${id}`, {});
  const row = (payload && payload.data && payload.data[0]) || null;
  if (!row) { console.log(`  ${id}: nothing`); continue; }
  console.log(`  ${id}`);
  console.log(`    keys: ${Object.keys(row).join(', ')}`);
  for (const key of Object.keys(row)) {
    if (/subject|concept|eurovoc|topic|theme|about|descriptor|classif/i.test(key)) {
      console.log(`    ${key}: ${JSON.stringify(row[key]).slice(0, 220)}`);
    }
  }
}

/* The procedure file is the other candidate. */
console.log('\nand a procedure?');
for (const shape of ['/procedures/2020/0002(NLE)', '/procedures?year=2021&limit=1', '/eli/dl/proc']) {
  try {
    const payload = await get(shape, {});
    const row = (payload && payload.data && payload.data[0]) || payload;
    console.log(`  ${shape}: ${row ? Object.keys(row).slice(0, 18).join(', ') : 'nothing'}`);
  } catch (error) {
    console.log(`  ${shape}: ${String(error.message).slice(0, 60)}`);
  }
}
