#!/usr/bin/env node
/*
 * Does the document join actually give the ninth term its subjects back, and
 * does it cost the tenth term anything?
 *
 * Three runs of this probe established the shape of the problem. The ninth
 * term's subjects are published, but on the report rather than on the vote:
 * a decision is labelled "A9-0018/2021 - Lara Wolters - Recital O/2 09/03/2021
 * 16:47:58.618" and carries no field pointing at the vote-result item that
 * says "Programme InvestEU", while the item carries none pointing back. Every
 * string on each side was compared against the other's keys and nothing
 * matched. What both carry is the report — the decision opens with its code,
 * the item names it as a document — so the code is the join, and where no item
 * exists at all the document's own title_dcterms still names the subject.
 *
 * That is now implemented, and this checks it against the portal rather than
 * against my expectations, on the real code path.
 *
 * Two questions. Does a ninth-term sitting come back with subjects instead of
 * filing references? And — the regression that matters — the part-of-a-text
 * filter now reads the decision's label rather than the record's title, because
 * the title is no longer the label; does that throw away any tenth-term vote
 * the old check kept? It must be none.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { english } from './lib/portal.mjs';
import { sittingVotes, buildRecord, isFinalVote } from './fetch-plenary.mjs';
import { isPartOfAText } from './lib/ep-sources.mjs';

const CODE = /^[A-Z]+(?:-[A-Z]+)?\d{1,2}-\d{4}\/\d{4}/;

async function look(date) {
  const votes = await sittingVotes(date);
  if (!votes) return console.log(`  ${date}: nothing`);

  const kept = votes.filter((vote) => isFinalVote(vote.decision) &&
    !isPartOfAText(english(vote.decision.activity_label)));

  const records = kept.map((vote) =>
    buildRecord(vote.decision, vote.item, {}, date, vote.subject, vote.code));
  const coded = records.filter((record) => CODE.test(record.title)).length;

  console.log(`  ${date}: ${votes.length} roll-call, ${kept.length} whole texts, ` +
    `${coded} still titled by a filing code`);
  records.slice(0, 6).forEach(function (record) {
    console.log(`    ${record.title.slice(0, 100)}`);
  });
  return { votes: votes, kept: kept };
}

console.log('the ninth term, with the join in place:');
for (const date of ['2020-02-12', '2021-03-09', '2023-04-18']) await look(date);

console.log('\nthe tenth term — does the new filter drop anything the old one kept?');
for (const date of ['2024-10-22', '2025-04-01']) {
  const votes = await sittingVotes(date);
  if (!votes) { console.log(`  ${date}: nothing`); continue; }
  const finals = votes.filter((vote) => isFinalVote(vote.decision));
  const byLabel = finals.filter((vote) => isPartOfAText(english(vote.decision.activity_label)));
  const byTitle = finals.filter(function (vote) {
    const record = buildRecord(vote.decision, vote.item, {}, date, vote.subject, vote.code);
    return isPartOfAText(record.title);
  });
  console.log(`  ${date}: ${finals.length} whole texts — ` +
    `the label drops ${byLabel.length}, the title dropped ${byTitle.length}`);
  byLabel.filter((vote) => byTitle.indexOf(vote) === -1).slice(0, 5).forEach(function (vote) {
    console.log(`    newly dropped: ${english(vote.decision.activity_label).slice(0, 100)}`);
  });
}
