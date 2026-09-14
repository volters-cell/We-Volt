#!/usr/bin/env node
/*
 * What counts as one vote, and where does a topic come from?
 *
 * The same days, counted both ways, say the difference is not one thing:
 *
 *   2019-07-18   portal   9    them  1
 *   2020-02-12   portal  49    them  7      this site: 9 votes on 7 texts
 *   2021-03-09   portal 130    them  0      this site: 0
 *   2023-04-18   portal  16    them 10      this site: 4
 *
 * On two of those days "one vote per text" lands exactly on their number, and
 * 2021-03-09 — a sitting that is entirely amendments — is empty for both. So
 * the unit is the text, not the ballot, and this project is close to that
 * already. But 18 April 2023 is the other way round: they keep ten and this
 * keeps four, so something here is throwing away whole texts. That is the
 * question worth answering before any rule is rewritten, because a rule that
 * makes the count agree by dropping more would be wrong in the same direction.
 *
 * So this prints that sitting decision by decision and says, for each, what
 * this project decides about it and why.
 *
 * The second half is the topic. A document carries is_about — EuroVoc concept
 * URIs, the Parliament's own subject vocabulary — but only one of three
 * documents tried had the field, so its coverage has to be measured rather
 * than hoped for. And a concept is a number until something names it, so this
 * asks where a name for one lives.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';
import { isPartOfAText } from './lib/ep-sources.mjs';
import { documentCode, isFinalVote } from './fetch-plenary.mjs';

console.log('18 April 2023, decision by decision');
const decisions = (await getAll('/meetings/MTG-PL-2023-04-18/decisions', {}, 500)).filter(isRollCall);
for (const decision of decisions) {
  const label = english(decision.activity_label);
  const about = decision.decisionAboutId ? 'about another text' : '';
  const part = isPartOfAText(label) ? 'part of a text' : '';
  const verdict = !isFinalVote(decision) ? `dropped (${about || 'amendment'})`
    : part ? 'dropped (part of a text)' : 'KEPT';
  console.log(`  ${verdict.padEnd(28)} ${documentCode(label) || '—'}  ${label.slice(0, 62)}`);
}

console.log('\nhow widely is is_about published?');
let carried = 0;
const codes = [];
for (const decision of decisions) {
  const code = documentCode(english(decision.activity_label));
  if (code && codes.indexOf(code) === -1) codes.push(code);
}
for (const code of codes.slice(0, 8)) {
  const path = code.replace(/^([A-Z]+(?:-[A-Z]+)?)(\d{1,2})-(\d{4})\/(\d{4})$/, '$1-$2-$4-$3');
  const payload = await get(`/documents/${path}`, {});
  const row = (payload && payload.data && payload.data[0]) || null;
  const about = row && row.is_about ? [].concat(row.is_about) : [];
  if (about.length) carried += 1;
  console.log(`  ${code.padEnd(16)} ${about.length ? `${about.length} concepts` : 'none'}`);
}
console.log(`  ${carried} of ${Math.min(codes.length, 8)} documents carry a subject`);

console.log('\nwhat names a concept?');
for (const shape of [
  '/eurovoc-concepts/5420',
  '/eurovoc/5420',
  '/concepts/5420',
  '/eurovoc-concepts?limit=2'
]) {
  try {
    const payload = await get(shape, {});
    const row = (payload && payload.data && payload.data[0]) || payload;
    if (!row) { console.log(`  ${shape.padEnd(28)} nothing`); continue; }
    console.log(`  ${shape.padEnd(28)} ${Object.keys(row).slice(0, 12).join(', ')}`);
    const named = row.label || row.prefLabel || row.title;
    if (named) console.log(`      -> ${JSON.stringify(english(named)).slice(0, 90)}`);
  } catch (error) {
    console.log(`  ${shape.padEnd(28)} ${String(error.message).slice(0, 50)}`);
  }
}
