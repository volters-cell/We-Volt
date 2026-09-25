#!/usr/bin/env node
/*
 * Rebuild data/decisions/index.json from the decision files themselves, newest
 * first. Run it after adding or editing a decision so the tracker feed and the
 * picker never drift from what is actually in the folder.
 *
 *   node scripts/build-index.mjs
 *
 * It also writes assets/groups/logos.json, the list of political group logos
 * that have actually been added. Without it the page has to guess, and a guess
 * means a browser console full of 404s for the eight groups whose logo nobody
 * has dropped in yet.
 

   SPDX-License-Identifier: AGPL-3.0-or-later
*/

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PLACE_NAMES } from './lib/topics.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';

const files = (await readdir(path.join(ROOT, DIR)))
  /* Records only. This directory also holds what this script writes —
     index.json and a term-N.json for every earlier Parliament — and on the
     second run it read its own output back as if it were a vote: a file with
     no id, which took the sort down with "cannot read properties of undefined".
     Two backfill runs failed that way before the cause was read off the log. */
  .filter((name) => name.endsWith('.json') && name !== 'index.json' &&
    !/^term-\d+\.json$/.test(name));

const decisions = [];
for (const name of files) {
  const decision = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  // Everything search should match on, flattened once here so the page does
  // not have to load every record to find one.
  // The institution is deliberately not in here: it is identical on every
  // record of a body, so including it made "euro" match all 614 votes through
  // "European Parliament". The filters cover institution already.
  //
  // Only what the entry does not already carry. The title and subtitle are
  // fields of their own, and repeating them here was a quarter of the whole
  // index — 113 KB of the 535 a phone downloads before it can show a vote.
  // The page puts the three together once when it loads.
  const keywords = [
    decision.summary,
    (decision.procedure && decision.procedure.reference) || '',
    ...(decision.whatItMeans || [])
  ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

  decisions.push({
    id: decision.id,
    sourceId: decision.sourceId || null,
    title: decision.title,
    subtitle: decision.subtitle || '',
    date: decision.date,
    body: decision.body,
    bodyLabel: decision.bodyLabel,
    // Only where it is not the usual rule. "Majority of votes cast" decided
    // 3,736 of the 3,752 votes and the card no longer prints it; the sixteen
    // that needed a majority of all members still carry it.
    ...(decision.voteRuleLabel && decision.voteRuleLabel !== 'Majority of votes cast'
      ? { voteRuleLabel: decision.voteRuleLabel } : {}),
    // The chips on the card: what the vote is about, read from its title,
    // and the committee that wrote the text where the portal gave one.
    topics: decision.topics || [],
    committee: decision.committee || null,
    rollCalls: decision.rollCalls || 1,
    result: (decision.outcome && decision.outcome.result) || 'recorded',
    status: decision.status,
    mepCount: Array.isArray(decision.ballots)
      ? decision.ballots.length
      : Object.values(decision.countries || {})
          .reduce((sum, country) => sum + ((country.meps || []).length), 0),
    // The record's own file is data/decisions/<id>.json for every vote, so the
    // path is not sent: whoever needs it derives it from the id.
    keywords: keywords
  });
}

decisions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));

/* One index per Parliament, not one for all of them.

   The sitting term is about 700 votes and its index is half a megabyte. The
   ninth is 7,676 — measured against the portal, not guessed — and a single
   index carrying both would put six megabytes into every first visit, most of
   it about a Parliament that no longer exists, to render a list that starts
   folded. So each term gets its own file, index.json carries the sitting one
   and a manifest of the rest, and the page fetches an earlier term the moment
   somebody opens its fold.

   The boundaries are the ones scripts/lib/ep-sources.mjs already uses to build
   the address of the minutes a record cites. A vote and its citation have to
   agree about which Parliament they belong to. */
const TERMS = [
  { term: 10, from: '2024-07-16', label: 'This Parliament', span: '2024–2029' },
  { term: 9, from: '2019-07-02', label: 'Previous Parliament', span: '2019–2024' },
  { term: 8, from: '0000-00-00', label: 'Eighth Parliament', span: '2014–2019' }
];
const termOf = (date) => TERMS.find((term) => date >= term.from) || TERMS[TERMS.length - 1];

const metadata = {
  project: 'EU Tracker',
  // Which topic labels name a place, so the filter panel can offer "Country"
  // and "Topic" as the two different questions they are. Written here rather
  // than repeated in the browser, so the vocabulary has one home.
  places: PLACE_NAMES,
  updated: new Date().toISOString().slice(0, 10),
  dataStatus: 'Votes of the European Parliament, from its open data portal. ' +
    'Summaries are editorial and may be absent. See about.html.'
};

const byTerm = new Map();
decisions.forEach((decision) => {
  const term = termOf(decision.date);
  if (!byTerm.has(term.term)) byTerm.set(term.term, { term, decisions: [] });
  byTerm.get(term.term).decisions.push(decision);
});

const present = [...byTerm.values()].sort((a, b) => b.term.term - a.term.term);
const latest = present[0];

/* Every term but the newest is written beside index.json under its own name,
   and index.json names them so the page knows what it can ask for without
   asking for it. */
const terms = [];
for (const row of present) {
  const file = row === latest ? 'index.json' : `term-${row.term.term}.json`;
  terms.push({
    term: row.term.term,
    label: row.term.label,
    span: row.term.span,
    votes: row.decisions.length,
    from: row.decisions[row.decisions.length - 1].date,
    until: row.decisions[0].date,
    file: row === latest ? null : `${DIR}/${file}`
  });
  if (row === latest) continue;
  await writeFile(path.join(ROOT, DIR, file),
    JSON.stringify({ metadata, term: row.term.term, decisions: row.decisions }, null, 2) + '\n', 'utf8');
  console.log(`${file} — ${row.decisions.length} decisions, ${row.decisions[row.decisions.length - 1].date} to ${row.decisions[0].date}`);
}

const index = {
  metadata,
  term: latest.term.term,
  terms,
  decisions: latest.decisions
};

await writeFile(path.join(ROOT, DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`index.json — ${latest.decisions.length} decisions of term ${latest.term.term}, ` +
  `newest ${latest.decisions[0].date}; ${terms.length - 1} earlier term${terms.length === 2 ? '' : 's'} beside it`);

/* Which group logos exist. Drop a file into assets/groups/ and run this. */
const GROUP_DIR = 'assets/groups';
let logos = [];
try {
  logos = (await readdir(path.join(ROOT, GROUP_DIR)))
    .filter((name) => /\.(svg|png|jpe?g)$/i.test(name))
    .sort();
} catch (error) {
  logos = [];
}
await writeFile(path.join(ROOT, GROUP_DIR, 'logos.json'), JSON.stringify(logos) + '\n', 'utf8');
console.log(`${GROUP_DIR}/logos.json — ${logos.length} logo${logos.length === 1 ? '' : 's'}`);
