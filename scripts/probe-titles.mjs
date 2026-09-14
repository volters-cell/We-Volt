#!/usr/bin/env node
/*
 * Why half the ninth term reads as a filing reference.
 *
 * A tenth-term vote is titled by its subject. A ninth-term vote, 835 times out
 * of 2,362, is titled like this:
 *
 *   A9-0002/2020 - Geert Bourgeois - Consent procedure 12/02/2020 12:09:01.000
 *
 * which names the report, its rapporteur, the kind of vote and the second it
 * was taken — everything except what was decided. The importer takes its title
 * from the vote-results item and falls back to the decision's own label, and in
 * the ninth term the item is often missing: 18 July 2019 answers with nine
 * decisions and four items. So the subject has to come from somewhere else.
 *
 * Two places it might. Either the items are there and this project fails to
 * join them to their decisions, or they genuinely are not and the report code
 * in the label can be resolved to a document that carries a real title.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, lastSegment } from './lib/portal.mjs';

const DAYS = ['2020-02-12', '2020-05-13', '2021-03-09', '2023-04-18'];

console.log('are the vote-result items there, and do they join?');
for (const date of DAYS) {
  const decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  const items = await getAll(`/meetings/MTG-PL-${date}/vote-results`, {}, 500);
  const byId = new Map();
  items.forEach(function (item) {
    byId.set(String(item.activity_id || lastSegment(item.id)), item);
  });
  const joined = decisions.filter(function (d) {
    return byId.has(String(d.notation_votingId || lastSegment(d.activity_id)));
  }).length;
  console.log(`  ${date}  ${decisions.length} decisions, ${items.length} items, ${joined} join`);
  if (items.length && joined < decisions.length) {
    console.log(`    a decision's key: ${JSON.stringify(decisions[0].notation_votingId || lastSegment(decisions[0].activity_id))}`);
    console.log(`    an item's keys:   ${JSON.stringify(items[0].activity_id)} / ${JSON.stringify(items[0].id)}`);
    console.log(`    an item's label:  ${JSON.stringify(english(items[0].activity_label)).slice(0, 140)}`);
  }
}

/* A9-0002/2020 is written A-9-2020-0002 in a document address, if it is
   addressable at all. Several spellings, so a wrong guess is not read as an
   absence. */
function spellings(code) {
  const m = /^([A-Z]+)(\d)-(\d{4})\/(\d{4})$/.exec(code);
  if (!m) return [];
  const [, kind, term, number, year] = m;
  return [
    `${kind}-${term}-${year}-${number}`,
    `${kind}${term}-${number}-${year}`,
    `${kind}${term}-${number}/${year}`
  ];
}

console.log('\ncan the report code be resolved to a titled document?');
for (const code of ['A9-0002/2020', 'A9-0014/2020', 'A9-0006/2020']) {
  console.log(`  ${code}`);
  for (const spelling of spellings(code)) {
    try {
      const payload = await get(`/documents/${spelling}`, {});
      const row = (payload && payload.data && payload.data[0]) || null;
      if (!row) { console.log(`    ${spelling.padEnd(20)} no rows`); continue; }
      const title = english(row.title) || english(row.activity_label) ||
        english(row.work_title) || null;
      console.log(`    ${spelling.padEnd(20)} OK  keys: ${Object.keys(row).slice(0, 14).join(', ')}`);
      console.log(`      title: ${JSON.stringify(title).slice(0, 160)}`);
    } catch (error) {
      console.log(`    ${spelling.padEnd(20)} ${String(error.message).slice(0, 50)}`);
    }
  }
}
