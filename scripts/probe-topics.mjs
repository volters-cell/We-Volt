#!/usr/bin/env node
/*
 * A label for a vote, from the Parliament and nowhere else.
 *
 * The API's own index settles the first question: it publishes no vocabulary.
 * /openapi.json, /swagger.json and /api-docs all answer 404, and so does every
 * spelling of a concept — eurovoc-concepts, concepts, subject-matters,
 * thesaurus, eurovoc-domains. A document says it is_about
 * http://eurovoc.europa.eu/121 and the Parliament will not tell you what 121
 * is. So "Gender equality" is not available here, and this project does not go
 * elsewhere for data.
 *
 * What is available is on the document already: creator, which holds the
 * committee that wrote the report — EP_ENVI, EP_AFCO, org/INTA. A committee is
 * a subject in the Parliament's own words, and the one it chose for this text.
 *
 * Two things have to hold before that becomes a chip on every card. The code
 * has to resolve to a name, or be nameable without inventing one, and it has
 * to be there often enough to be worth a reader's attention. Both are measured
 * here across four years, rather than assumed from three documents.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';
import { documentCode } from './fetch-plenary.mjs';

const DAYS = ['2020-02-12', '2021-03-09', '2023-04-18', '2024-10-22', '2025-09-09'];

function committeeOf(creator) {
  for (const entry of [].concat(creator || [])) {
    const text = String(typeof entry === 'string' ? entry : entry.id || '');
    if (/person\//.test(text)) continue;
    const code = text.split('/').pop().replace(/^EP_/, '');
    if (/^[A-Z]{3,6}\d?$/.test(code)) return code;
  }
  return null;
}

console.log('how often does a vote reach a committee?');
const codes = new Map();
let withCommittee = 0;
let total = 0;
for (const date of DAYS) {
  let decisions = [];
  try {
    decisions = (await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500)).filter(isRollCall);
  } catch (error) {
    console.log(`  ${date}: the portal would not answer`);
    continue;
  }
  const documents = [...new Set(decisions.map((d) => documentCode(english(d.activity_label))).filter(Boolean))];
  let hit = 0;
  for (const code of documents) {
    const path = code.replace(/^([A-Z]+(?:-[A-Z]+)?)(\d{1,2})-(\d{4})\/(\d{4})$/, '$1-$2-$4-$3');
    const payload = await get(`/documents/${path}`, {});
    const row = (payload && payload.data && payload.data[0]) || null;
    const committee = row ? committeeOf(row.creator) : null;
    if (committee) { hit += 1; codes.set(committee, (codes.get(committee) || 0) + 1); }
  }
  withCommittee += hit;
  total += documents.length;
  console.log(`  ${date}  ${hit} of ${documents.length} texts name a committee`);
}
console.log(`  ${withCommittee} of ${total} overall`);
console.log(`  committees seen: ${[...codes.keys()].sort().join(' ')}`);

console.log('\ndoes a committee code have a name at the Parliament?');
for (const code of [...codes.keys()].slice(0, 4)) {
  for (const shape of [`/corporate-bodies/${code}`, `/corporate-bodies/EP_${code}`]) {
    try {
      const answer = await get(shape, {});
      const row = (answer && answer.data && answer.data[0]) || null;
      console.log(`  ${shape.padEnd(34)} ${row ? JSON.stringify(english(row.label)).slice(0, 70) : 'nothing'}`);
    } catch (error) {
      console.log(`  ${shape.padEnd(34)} ${String(error.message).slice(0, 40)}`);
    }
  }
}
