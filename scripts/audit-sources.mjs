#!/usr/bin/env node
/*
 * Check what the site holds against what the Parliament holds.
 *
 *   node scripts/audit-sources.mjs                  the whole term
 *   node scripts/audit-sources.mjs --since 2026-01-01
 *   node scripts/audit-sources.mjs --write          save the report
 *
 * The importer says what it wrote. This says whether that is everything, by
 * asking the portal for every sitting of the term and comparing, vote by vote:
 *
 *   - a roll-call the Parliament recorded and this site does not hold
 *   - a record here with no matching vote at the Parliament
 *   - a tally here that disagrees with the Parliament's own figures
 *   - a ballot naming somebody the member directory cannot identify
 *
 * Votes are matched on the Parliament's own voting id, which each record keeps
 * as sourceId. That is also what makes the older archive checkable: it was
 * seeded before this importer existed, and either its ids are the Parliament's
 * or they are not.
 *
 * Exits non-zero if anything is missing or disagrees, so it can guard a build.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getAll, isRollCall, ballotsOf, tallyOf } from './lib/portal.mjs';
import { isFinalVote } from './fetch-plenary.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TERM_START = '2024-07-16';
const REPORT = 'data/reference/coverage.json';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = !next || next.startsWith('--') ? true : (i += 1, next);
  }
  return args;
}

async function localRecords() {
  const dir = path.join(ROOT, 'data/decisions');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json');
  const byId = new Map();
  for (const name of files) {
    const record = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    if (record.body !== 'parliament') continue;
    byId.set(String(record.sourceId), {
      file: name,
      date: record.date,
      ballots: (record.ballots || []).length,
      headline: record.outcome && record.outcome.headline
    });
  }
  return byId;
}

/* The headline carries the three figures the record claims. Reading them back
   is how a record's arithmetic gets checked against the Parliament's. */
export function statedTally(headline) {
  const match = String(headline || '').match(/(\d+) in favour, (\d+) against, (\d+) abstained/);
  return match ? { for: +match[1], against: +match[2], abstain: +match[3] } : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = typeof args.since === 'string' ? args.since : TERM_START;
  const until = typeof args.until === 'string' ? args.until : new Date().toISOString().slice(0, 10);

  const held = await localRecords();
  const directory = JSON.parse(await readFile(path.join(ROOT, 'data/reference/meps.json'), 'utf8')).members || {};

  const years = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year += 1) years.push(year);
  const sittings = new Set();
  for (const year of years) {
    (await getAll('/meetings', { year: year }, 400)).forEach(function (meeting) {
      const date = meeting.activity_date;
      if (!date || date < from || date > until) return;
      if (meeting.had_activity_type && meeting.had_activity_type.indexOf('PLENARY') === -1) return;
      sittings.add(date);
    });
  }
  const dates = [...sittings].sort();
  console.log(`${dates.length} sittings between ${from} and ${until}; ${held.size} records on file.\n`);

  const days = [];
  const missing = [];
  const disagreeing = [];
  const strangers = new Map();
  const seen = new Set();
  const amendments = new Set();
  let rollCallsSeen = 0;
  let finalVotesSeen = 0;
  let matched = 0;

  for (const date of dates) {
    const decisions = (await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500)).filter(isRollCall);
    rollCallsSeen += decisions.length;
    const finals = decisions.filter(isFinalVote);
    finalVotesSeen += finals.length;
    decisions.forEach(function (decision) {
      if (!isFinalVote(decision)) amendments.add(String(decision.notation_votingId || ''));
    });

    let here = 0;
    for (const decision of finals) {
      const id = String(decision.notation_votingId || '');
      const record = held.get(id);
      if (!record) {
        missing.push({ date: date, votingId: id, title: decision.activity_label && decision.activity_label.en });
        continue;
      }
      here += 1;
      matched += 1;
      seen.add(id);

      const theirs = tallyOf(decision);
      const ours = statedTally(record.headline);
      if (ours && (ours.for !== theirs.for || ours.against !== theirs.against || ours.abstain !== theirs.abstain)) {
        disagreeing.push({ file: record.file, ours: ours, theirs: theirs });
      }
      const ballots = ballotsOf(decision);
      if (record.ballots !== ballots.length) {
        disagreeing.push({ file: record.file, ballotsHere: record.ballots, ballotsThere: ballots.length });
      }
      ballots.forEach(function (ballot) {
        if (!directory[String(ballot[0])]) strangers.set(String(ballot[0]), (strangers.get(String(ballot[0])) || 0) + 1);
      });
    }

    days.push({ date: date, rollCalls: decisions.length, finalVotes: finals.length, onFile: here });
    const flag = here === finals.length ? ' ' : '!';
    console.log(`${flag} ${date}  ${String(decisions.length).padStart(3)} roll-calls  ` +
      `${String(finals.length).padStart(3)} final  ${String(here).padStart(3)} on file`);
  }

  // Records here that the Parliament's sittings did not produce. An amendment
  // vote counts as matched too: the default filter skips those on import, but
  // holding one is not an error.
  const orphans = [];
  for (const [id, record] of held) {
    if (record.date < from || record.date > until) continue;
    if (!sittings.has(record.date)) orphans.push({ file: record.file, date: record.date, reason: 'no such sitting' });
    else if (!seen.has(id) && !amendments.has(id)) {
      orphans.push({ file: record.file, votingId: id, reason: 'not among the sitting\'s votes' });
    }
  }

  const report = {
    checked: new Date().toISOString().slice(0, 10),
    window: { from: from, until: until },
    sittings: dates.length,
    rollCallVotes: rollCallsSeen,
    finalVotes: finalVotesSeen,
    onFile: matched,
    recordsHere: held.size,
    missing: missing,
    disagreeing: disagreeing,
    unknownVoters: [...strangers.keys()],
    hereOnly: orphans,
    days: days
  };

  console.log('\n--- what the Parliament has, and what is here ---');
  console.log(`sittings                 ${dates.length}`);
  console.log(`roll-call votes          ${rollCallsSeen}`);
  console.log(`  of them votes on a text ${finalVotesSeen}`);
  console.log(`  held here               ${matched}`);
  console.log(`records on file          ${held.size}`);
  console.log(`missing                  ${missing.length}`);
  console.log(`disagreeing              ${disagreeing.length}`);
  console.log(`ballots naming an unknown member  ${strangers.size}`);

  missing.slice(0, 20).forEach(function (item) {
    console.log(`  missing  ${item.date}  ${item.votingId}  ${String(item.title || '').slice(0, 70)}`);
  });
  if (missing.length > 20) console.log(`  … and ${missing.length - 20} more`);
  disagreeing.slice(0, 20).forEach(function (item) { console.log('  disagrees', JSON.stringify(item)); });
  orphans.slice(0, 10).forEach(function (item) { console.log('  here only', JSON.stringify(item)); });

  if (args.write) {
    await writeFile(path.join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(`\n${REPORT} written.`);
  }

  const wrong = missing.length + disagreeing.length + strangers.size;
  if (wrong) {
    console.log('\nThe site does not hold everything the Parliament recorded.');
    process.exit(1);
  }
  console.log('\nEverything the Parliament recorded for this window is here, with matching figures.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
