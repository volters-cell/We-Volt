#!/usr/bin/env node
/*
 * Import roll-call votes straight from the European Parliament.
 *
 *   node scripts/fetch-plenary.mjs                       the last fortnight
 *   node scripts/fetch-plenary.mjs --date 2026-07-09     one sitting
 *   node scripts/fetch-plenary.mjs --since 2024-07-16    the whole term
 *   node scripts/fetch-plenary.mjs --all                 amendments too
 *   node scripts/fetch-plenary.mjs --date … --dry-run
 *   node scripts/fetch-plenary.mjs --refresh-meps        rebuild the directory
 *
 * The source is the Parliament's open data portal, data.europarl.europa.eu.
 * Its record of a sitting's decisions carries, for every roll-call vote, three
 * lists of person ids: who voted for, who voted against, who abstained. That is
 * the whole of this project's raw material.
 *
 * The Parliament's public website is not used. It answers automated requests
 * with an empty 202 whatever the address, so nothing can be read from it; the
 * annex link kept on each record is for a reader with a browser, not for this
 * importer.
 *
 * A decision belongs to a vote item, and the item names the report and the
 * procedure. That is what turns "Article 3, § 1, point b – Am 16" into a record
 * headed "Establishment of the digital euro", filed under 2023/0212.
 *
 * Nothing editorial is ever generated: a record arrives with an empty summary.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  PORTAL, get, getAll, english, lastSegment, fetchMembers,
  isRollCall, ballotsOf, tallyOf
} from './lib/portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TERM = 10; // 2024–2029
const TERM_START = '2024-07-16'; // the constitutive sitting after the June 2024 elections
const MEP_CACHE = 'data/reference/meps.json';

/* Amendments are the bulk of a plenary and the least of its meaning. By default
   only the votes on a text as a whole are kept. The portal marks an amendment
   plainly — the decision carries the number it is about — so this is a reading
   of the record rather than a guess at its wording. */
const AMENDMENT = /\b(am|amendement|amendment)s?\s*\d+/i;

/* A reader's link to the annex. It opens in a browser; it is not fetched. */
const ANNEX_URL = (term, date) =>
  `https://www.europarl.europa.eu/doceo/document/PV-${term}-${date}-RCV_EN.xml`;

/* ------------------------------------------------------------------ helpers */

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

export function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 58);
}

/* "eli/dl/proc/2023-0212" is the procedure 2023/0212. */
export function procedureReference(uri) {
  const match = String(uri || '').match(/proc\/(\d{4})-(\d{4})/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/* "eli/dl/doc/A-10-2026-0185" is the report A10-0185/2026. */
export function documentReference(uri) {
  const match = String(uri || '').match(/doc\/([AB])-(\d{1,2})-(\d{4})-(\d{4})/);
  return match ? `${match[1]}${match[2]}-${match[4]}/${match[3]}` : null;
}

/* The portal returns a link either as a bare string or as an object with an
   id. Both mean the same thing. */
function idsOf(value) {
  return [].concat(value || []).map(function (entry) {
    return typeof entry === 'string' ? entry : (entry && entry.id) || '';
  }).filter(Boolean);
}

/* The Parliament marks the procedure a text is under in its own title: *** for
   consent, ***I, ***II and ***III for the readings of the ordinary legislative
   procedure, * for consultation. It means something to a clerk and nothing to a
   reader, and the record keeps the procedure in its own field anyway. */
export function plainTitle(text) {
  return String(text || '')
    .replace(/(^|\s)\*{1,3}(I{1,3})?(?=\s|$)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([–—-])\s*$/, '')
    .trim();
}

/* The vote item's structured label states the majority a text needed. */
export function voteRuleOf(label) {
  const text = String(label || '');
  if (/component Members|composantes|Mitglieder des Parlaments/i.test(text)) {
    return { rule: 'absolute-majority', label: 'Majority of Parliament\'s component members' };
  }
  if (/two-thirds|deux tiers/i.test(text)) {
    return { rule: 'two-thirds', label: 'Two-thirds of the votes cast' };
  }
  return { rule: 'simple-majority', label: 'Majority of votes cast' };
}

export function outcomeOf(decision) {
  const stated = String(decision.had_decision_outcome || '').toUpperCase();
  if (stated.indexOf('ADOPT') !== -1) return 'adopted';
  if (stated.indexOf('REJECT') !== -1) return 'rejected';
  if (stated.indexOf('LAPSE') !== -1) return 'lapsed';
  if (stated.indexOf('WITHDRAW') !== -1) return 'withdrawn';
  return null;
}

/* ---------------------------------------------------------- the directory */

async function loadMembers(args) {
  const cachePath = path.join(ROOT, MEP_CACHE);
  let cached = null;
  try {
    cached = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    cached = null;
  }

  const known = (cached && cached.members) || {};
  if (!args['refresh-meps'] && Object.keys(known).length) return known;

  let members;
  try {
    members = await fetchMembers(Number(args.term || TERM), { known: known });
  } catch (error) {
    if (!Object.keys(known).length) {
      throw new Error(`The member directory could not be fetched (${error.message}) and nothing is cached.`);
    }
    console.warn(`The member directory could not be refreshed (${error.message}); using the cached one.`);
    return known;
  }

  const sitting = Object.values(members).filter(function (member) { return !member.former; }).length;
  await writeFile(cachePath, JSON.stringify({
    source: `${PORTAL}/meps/show-current`,
    fetched: new Date().toISOString().slice(0, 10),
    term: Number(args.term || TERM),
    note: 'Every member who has held a seat in this Parliament: name, country and ' +
      'political group, stored once. Vote records reference members by id rather ' +
      'than repeating this, which keeps a whole term of roll-calls at tens of megabytes. ' +
      'Members marked former have left the House; the portal no longer states their group.',
    members: members
  }, null, 2) + '\n', 'utf8');
  console.log(`${MEP_CACHE}: ${sitting} sitting members, ${Object.keys(members).length} in the term.`);
  return members;
}

/* --------------------------------------------------------- sitting days */

/* Which days the Parliament sat, from the portal's own meeting list. Cheaper
   and truer than trying every weekday and collecting 404s. */
export async function sittingDates(from, until) {
  const years = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year += 1) years.push(year);

  const dates = new Set();
  for (const year of years) {
    const meetings = await getAll('/meetings', { year: year }, 400);
    meetings.forEach(function (meeting) {
      const date = meeting.activity_date;
      if (!date || date < from || date > until) return;
      if (meeting.had_activity_type && meeting.had_activity_type.indexOf('PLENARY') === -1) return;
      dates.add(date);
    });
  }
  return [...dates].sort();
}

/* ------------------------------------------------------- a sitting's votes */

export function buildRecord(decision, item, members, date, term) {
  const ballots = ballotsOf(decision);
  const totals = tallyOf(decision);

  const itemTitle = plainTitle(english(item && item.activity_label).replace(/\s+/g, ' '));
  const decisionTitle = plainTitle(english(decision.activity_label).replace(/\s+/g, ' '));
  const title = itemTitle || decisionTitle || 'Roll-call vote';
  const detail = itemTitle && decisionTitle && decisionTitle !== itemTitle ? decisionTitle : '';

  const structured = english(item && item.structuredLabel);
  const rule = voteRuleOf(structured);
  const report = idsOf(item && item.based_on_a_realization_of).map(documentReference).find(Boolean) || null;
  const procedure = idsOf(item && item.inverse_consists_of).map(procedureReference).find(Boolean) || null;

  const stated = outcomeOf(decision);
  const adopted = stated ? stated === 'adopted' : totals.for > totals.against;
  const votingId = decision.notation_votingId || lastSegment(decision.activity_id);

  const counted = ballots.filter(function (ballot) { return members[String(ballot[0])]; }).length;

  return {
    id: `ep-${date}-${slug(procedure || report || title) || 'vote'}-${votingId}`,
    sourceId: Number(votingId) || votingId,
    status: 'verified',
    dataNote: stated
      ? 'Roll-call vote of the European Parliament, imported from its open data portal. ' +
        'The portal records how each member voted and states whether the text carried.'
      : 'Roll-call vote of the European Parliament, imported from its open data portal. ' +
        'The portal records how each member voted; it does not state whether this text ' +
        'carried, so the result below follows from the totals — more in favour than ' +
        'against. Votes needing an absolute majority are the exception.',
    body: 'parliament',
    bodyLabel: 'European Parliament',
    title: title,
    subtitle: (detail ? detail + ' — ' : '') + 'roll-call vote in plenary',
    date: date,
    voteRule: rule.rule,
    voteRuleLabel: rule.label,
    procedure: { reference: procedure || report, url: null },
    summary: '',
    whatItMeans: [],
    outcome: {
      result: stated && stated !== 'adopted' && stated !== 'rejected'
        ? stated
        : (adopted ? 'adopted' : 'rejected'),
      headline: `${adopted ? 'Adopted' : 'Rejected'} — ${totals.for} in favour, ` +
        `${totals.against} against, ${totals.abstain} abstained.` +
        (stated ? '' : ' Result derived from the totals.')
    },
    ballots: ballots,
    sources: [
      { label: 'Roll-call annex to the minutes', url: ANNEX_URL(term, date) },
      {
        label: 'European Parliament open data',
        url: `${PORTAL}/meetings/MTG-PL-${date}/decisions?format=application%2Fld%2Bjson`
      }
    ],
    countries: {},
    _counted: counted
  };
}

/* A vote on the text as a whole, rather than on one amendment to it. The portal
   marks an amendment by the thing it amends, which is a fact in the record
   rather than a reading of its title. */
export function isFinalVote(decision) {
  if (decision.decisionAboutId) return false;
  return !AMENDMENT.test(english(decision.activity_label));
}

async function sittingVotes(date) {
  const decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  if (!decisions.length) return null;

  const items = await getAll(`/meetings/MTG-PL-${date}/vote-results`, {}, 500);
  const byId = new Map();
  items.forEach(function (item) { byId.set(String(item.activity_id || lastSegment(item.id)), item); });

  return decisions.filter(isRollCall).map(function (decision) {
    const parent = idsOf(decision.inverse_consists_of)
      .map(function (id) { return byId.get(lastSegment(id)) || byId.get(String(id).replace(/^.*event\//, '')); })
      .find(Boolean) || null;
    return { decision: decision, item: parent };
  });
}

/* Every voting id already on file, and the record that holds it. The
   Parliament numbers each vote once, so holding the same number twice would
   put the same vote on the page twice — which is what a backfill over records
   written before this importer existed would otherwise do. */
async function alreadyHeld(outDir) {
  const directory = path.resolve(ROOT, outDir);
  const held = new Map();
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    return held; // nothing imported yet
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    try {
      const record = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      if (record.sourceId !== undefined && record.sourceId !== null) held.set(String(record.sourceId), name);
    } catch (error) {
      // a file that will not parse is the validator's problem, not this one's
    }
  }
  return held;
}

/* --------------------------------------------------------------- the run */

function requestedDates(args) {
  if (args.date) return { from: String(args.date), until: String(args.date) };
  if (args.since) {
    return {
      from: String(args.since),
      until: args.until ? String(args.until) : new Date().toISOString().slice(0, 10)
    };
  }
  // Default: the last fortnight, which covers a plenary that has just finished.
  const until = new Date();
  const from = new Date(until.getTime() - 14 * 86400000);
  return { from: from.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const term = Number(args.term || TERM);
  const floor = typeof args.from === 'string' ? args.from : TERM_START;
  const outDir = typeof args.out === 'string' ? args.out : 'data/decisions';

  const members = await loadMembers(args);

  const window = requestedDates(args);
  const from = window.from < floor ? floor : window.from;
  const dates = await sittingDates(from, window.until);
  console.log(`${dates.length} sitting day${dates.length === 1 ? '' : 's'} between ${from} and ${window.until}.`);

  const held = await alreadyHeld(outDir);
  const written = [];
  const taken = new Set();
  let skipped = 0;
  let already = 0;

  for (const date of dates) {
    const votes = await sittingVotes(date);
    if (!votes || !votes.length) {
      console.log(`${date}: no roll-call votes recorded.`);
      continue;
    }

    for (const vote of votes) {
      if (!args.all && !isFinalVote(vote.decision)) {
        skipped += 1;
        continue;
      }
      const record = buildRecord(vote.decision, vote.item, members, date, term);
      const counted = record._counted;
      delete record._counted;

      if (!record.ballots.length) continue;

      // Held already, under whatever name it was first written with.
      const existing = held.get(String(record.sourceId));
      if (existing && existing !== `${record.id}.json`) {
        already += 1;
        continue;
      }
      if (taken.has(record.id)) record.id += '-' + taken.size;
      taken.add(record.id);

      const unknown = record.ballots.length - counted;
      if (unknown) {
        console.warn(`${date}: ${unknown} of ${record.ballots.length} ballots name a member ` +
          'the directory does not know — run with --refresh-meps.');
      }

      // resolve, not join: an absolute --out must not end up under the repo.
      const directory = path.resolve(ROOT, outDir);
      const file = path.join(directory, `${record.id}.json`);
      const shown = path.relative(ROOT, file);
      const totals = tallyOf(vote.decision);
      const tally = `${record.outcome.result} ${totals.for}/${totals.against}/${totals.abstain}`;
      if (args['dry-run']) {
        console.log(`would write ${shown} — ${tally}`);
      } else {
        await mkdir(directory, { recursive: true });
        await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
        console.log(`${shown} — ${tally}`);
      }
      held.set(String(record.sourceId), `${record.id}.json`);
      written.push(record.id);
    }
  }

  console.log(`\n${written.length} record${written.length === 1 ? '' : 's'}` +
    (already ? `, ${already} already held` : '') +
    (skipped ? `, ${skipped} amendment votes skipped (pass --all to keep them)` : '') + '.');
  if (written.length && !args['dry-run']) {
    console.log('Next: node scripts/build-index.mjs, then node scripts/validate-data.mjs');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
