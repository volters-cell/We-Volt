#!/usr/bin/env node
/*
 * Two things the last run found, checked again.
 *
 * The document join works — 18 April 2023 came back with every vote titled by
 * its subject and none by a filing code — and the tenth term loses nothing to
 * the filter now reading the decision's label instead of the record's title:
 * zero dropped on both sittings tried.
 *
 * But 9 March 2021 came back with eleven whole texts, all eleven still titled
 * by a code, and every one of them was a part vote the filter should have
 * caught: "Annex, part II/2", "Citation 11", "Article 4, § 3/2". They survived
 * because the Parliament stamps the label with the moment of the vote —
 * "09/03/2021 16:47:58.618" — and every pattern that ends the tail failed
 * against the stamp. That is now fixed, and it means those votes are in the
 * shipped archive today as whole texts.
 *
 * The second thing has no explanation yet. Those same votes fell back to the
 * label, which means the report's own title came back empty for A9-0018/2021
 * and A9-0019/2021 where it answered for A9-0002/2020. So this asks the
 * document endpoint directly, across codes from four years and all three
 * kinds, before any more is built on the assumption that it answers.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { english, documentPath, documentTitle } from './lib/portal.mjs';
import { sittingVotes, buildRecord, isFinalVote } from './fetch-plenary.mjs';
import { isPartOfAText } from './lib/ep-sources.mjs';

const CODE = /^[A-Z]+(?:-[A-Z]+)?\d{1,2}-\d{4}\/\d{4}/;

console.log('does the document endpoint answer, and for which codes?');
for (const code of ['A9-0002/2020', 'A9-0018/2021', 'A9-0019/2021', 'A9-0203/2020',
  'A9-0056/2023', 'B9-0088/2020', 'RC-B9-0006/2019', 'A9-0009/2019']) {
  const title = await documentTitle(code);
  console.log(`  ${code.padEnd(16)} ${String(documentPath(code)).padEnd(18)} ` +
    (title ? `"${title.slice(0, 70)}"` : 'nothing'));
}

console.log('\nand the sittings, with the stamp no longer hiding the parts:');
for (const date of ['2020-02-12', '2021-03-09', '2023-04-18']) {
  const votes = await sittingVotes(date);
  if (!votes) { console.log(`  ${date}: nothing`); continue; }
  const kept = votes.filter((vote) => isFinalVote(vote.decision) &&
    !isPartOfAText(english(vote.decision.activity_label)));
  const records = kept.map((vote) =>
    buildRecord(vote.decision, vote.item, {}, date, vote.subject, vote.code));
  const coded = records.filter((record) => CODE.test(record.title)).length;
  console.log(`  ${date}: ${votes.length} roll-call, ${kept.length} whole texts, ` +
    `${coded} still titled by a filing code`);
  records.slice(0, 5).forEach((record) => console.log(`    ${record.title.slice(0, 95)}`));
}
