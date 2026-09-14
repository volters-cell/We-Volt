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
 * with an empty 202 whatever the address, so nothing can be read from it, and
 * a record no longer carries a link into it: what each record names as its
 * source is the open data it was actually read from.
 *
 * A decision belongs to a vote item, and the item names the report and the
 * procedure. That is what turns "Article 3, § 1, point b – Am 16" into a record
 * headed "Establishment of the digital euro", filed under 2023/0212.
 *
 * Nothing editorial is ever generated: a record arrives with an empty summary.
 

   SPDX-License-Identifier: AGPL-3.0-or-later
*/

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  PORTAL, get, getAll, english, lastSegment, fetchMembers, meetingDate,
  documentTitle, isRollCall, ballotsOf, tallyOf
} from './lib/portal.mjs';
import { sourcesFor, procedureUrl, isPartOfAText, STAMPED } from './lib/ep-sources.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TERM = 10; // 2024–2029
const TERM_START = '2024-07-16'; // the constitutive sitting after the June 2024 elections
const MEP_CACHE = 'data/reference/meps.json';

/* Amendments are the bulk of a plenary and the least of its meaning. By default
   only the votes on a text as a whole are kept. The portal marks an amendment
   plainly — the decision carries the number it is about — so this is a reading
   of the record rather than a guess at its wording. */
const AMENDMENT = /\b(am|amendement|amendment)s?\s*\d+/i;

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

/* The report a decision was taken on, read off its own label.

   A ninth-term decision is labelled "A9-0018/2021 - Lara Wolters - Recital O/2
   09/03/2021 16:47:58.618". It carries no field pointing at the vote-result
   item that names the subject, and the item carries none pointing back — every
   string on each side was compared against the other's keys, and nothing
   matched. What both do carry is the report: the decision opens with its code,
   and the item names it as a document. So the code is the join.

   Only at the head of the label, where the Parliament writes it. A code
   appearing later belongs to something the vote mentions, not to the vote. */
export function documentCode(label) {
  const match = /^\s*([A-Z]+(?:-[A-Z]+)?\d{1,2}-\d{4}\/\d{4})/.exec(String(label || ''));
  return match ? match[1] : null;
}

/* A document title as the Parliament files it — "RECOMMENDATION on the draft
   Council decision on the conclusion..." — set in the case a sentence is
   written in. The shouting is a filing convention, not emphasis. */
export function plainSubject(title) {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = /^([A-Z]{4,}(?:\s+[A-Z]{4,})*)\b/.exec(text);
  if (!match) return text;
  const head = match[1];
  return head.charAt(0) + head.slice(1).toLowerCase() + text.slice(head.length);
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
    // "09/03/2021 16:47:58.618" is when the vote was taken, not part of its
    // name, and the date is already on the record.
    .replace(STAMPED, '')
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

  /* Merged into what was already known, not written over it.

     fetchMembers builds its answer from the sitting members plus the term it
     was asked for. Asked for the ninth, it does not return a tenth-term member
     who has since left — and every ballot that names one would become a number
     with no name. So the fetch adds and corrects; it never removes. */
  const merged = Object.assign({}, known, members);
  const added = Object.keys(merged).length - Object.keys(known).length;
  /* Which terms this directory covers. Seeded from the single "term" the file
     used to carry as well as the list, or the first merge would claim the file
     holds only the term just fetched — it holds both. */
  const terms = [...new Set([].concat((cached && cached.terms) || [],
    (cached && cached.term) || [], Number(args.term || TERM)))]
    .sort(function (a, b) { return b - a; });

  const sitting = Object.values(merged).filter(function (member) { return !member.former; }).length;
  await writeFile(cachePath, JSON.stringify({
    source: `${PORTAL}/meps/show-current`,
    fetched: new Date().toISOString().slice(0, 10),
    term: Number(args.term || TERM),
    terms: terms,
    note: 'Every member who has held a seat in this Parliament: name, country and ' +
      'political group, stored once. Vote records reference members by id rather ' +
      'than repeating this, which keeps a whole term of votes at tens of megabytes. ' +
      'Members marked former have left the House; the portal no longer states their group.',
    members: merged
  }, null, 2) + '\n', 'utf8');
  console.log(`${MEP_CACHE}: ${sitting} sitting, ${Object.keys(merged).length} known across terms ` +
    `${terms.join(', ')} (${added >= 0 ? '+' : ''}${added} this run).`);
  return merged;
}

/* --------------------------------------------------------- sitting days */

/* Which days the Parliament sat, from the portal's own meeting list. Cheaper
   and truer than trying every weekday and collecting 404s.

   The day comes from meetingDate rather than straight off the field, because
   the portal spells that field differently in different years and the plain
   spelling is absent for the whole of 2019. See the note there. */
export async function sittingDates(from, until) {
  const years = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year += 1) years.push(year);

  const dates = new Set();
  for (const year of years) {
    const meetings = await getAll('/meetings', { year: year }, 400);
    meetings.forEach(function (meeting) {
      const date = meetingDate(meeting);
      if (!date || date < from || date > until) return;
      if (meeting.had_activity_type && meeting.had_activity_type.indexOf('PLENARY') === -1) return;
      dates.add(date);
    });
  }
  return [...dates].sort();
}

/* ------------------------------------------------------- a sitting's votes */

export function buildRecord(decision, item, members, date, subject, code) {
  const ballots = ballotsOf(decision);
  const totals = tallyOf(decision);

  const itemTitle = plainTitle(english(item && item.activity_label).replace(/\s+/g, ' '));
  const decisionTitle = plainTitle(english(decision.activity_label).replace(/\s+/g, ' '));
  // The report's own title, where the sitting's items reach neither this
  // decision nor its report. It is the last thing that names a subject, and
  // without it a ninth-term vote is titled by its filing reference.
  const documentSubject = plainTitle(String(subject || '').replace(/\s+/g, ' '));
  const title = itemTitle || documentSubject || decisionTitle || 'Roll-call vote';
  const detail = title !== decisionTitle ? decisionTitle : '';

  const structured = english(item && item.structuredLabel);
  const rule = voteRuleOf(structured);
  // The report, from the item where there is one and otherwise from the code
  // the decision's own label opens with. This is what gives a ninth-term vote
  // a procedure link at all.
  const report = idsOf(item && item.based_on_a_realization_of).map(documentReference).find(Boolean) ||
    code || null;
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
      ? 'Vote of the European Parliament, imported from its open data portal. ' +
        'The portal records how each member voted and states whether the text carried.'
      : 'Vote of the European Parliament, imported from its open data portal. ' +
        'The portal records how each member voted; it does not state whether this text ' +
        'carried, so the result below follows from the totals — more in favour than ' +
        'against. Votes needing an absolute majority are the exception.',
    body: 'parliament',
    bodyLabel: 'European Parliament',
    title: title,
    subtitle: (detail ? detail + ' — ' : '') + 'vote in plenary',
    date: date,
    voteRule: rule.rule,
    voteRuleLabel: rule.label,
    procedure: {
      reference: procedure || report,
      url: procedureUrl(procedure || report)
    },
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
    // Where a reader can check this vote at the Parliament: the roll-call
    // results it is recorded in, the minutes of the sitting, the procedure
    // file where there is one, and the data this was read from. Every shape
    // was tried against the Parliament's servers before it was written here —
    // see scripts/probe-vote-links.mjs.
    sources: sourcesFor(date, procedure || report),
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

export async function sittingVotes(date) {
  const decisions = await getAll(`/meetings/MTG-PL-${date}/decisions`, {}, 500);
  if (!decisions.length) return null;

  /* The vote-result items are worth having and not worth losing a year over.
     They carry a subject where the decision's label carries a filing code, but
     the decision carries the ballots, the totals and the outcome — everything
     a record is — and the subject has a second route through the report. So a
     sitting whose items the portal will not serve is imported without them.

     This tolerance is for the items alone. The decisions above are fetched
     without it, because a sitting that silently imported as empty would, on a
     re-read, look like a day the Parliament did not vote. */
  let items = [];
  try {
    items = await getAll(`/meetings/MTG-PL-${date}/vote-results`, {}, 500);
  } catch (error) {
    console.warn(`${date}: the portal would not serve the vote items ` +
      `(${error.message}). Titles for this sitting come from the reports instead.`);
  }
  const byId = new Map();
  items.forEach(function (item) { byId.set(String(item.activity_id || lastSegment(item.id)), item); });

  // The same items, reached by the report they are about, for the decisions
  // that do not point at them.
  const byDocument = new Map();
  items.forEach(function (item) {
    idsOf(item.based_on_a_realization_of).forEach(function (uri) {
      const reference = documentReference(uri);
      if (reference && !byDocument.has(reference)) byDocument.set(reference, item);
    });
  });

  const votes = decisions.filter(isRollCall).map(function (decision) {
    const code = documentCode(english(decision.activity_label));
    const parent = idsOf(decision.inverse_consists_of)
      .map(function (id) { return byId.get(lastSegment(id)) || byId.get(String(id).replace(/^.*event\//, '')); })
      .find(Boolean) || (code ? byDocument.get(code) || null : null);
    return { decision: decision, item: parent, code: code };
  });

  /* Where neither route reaches a usable title, the report itself still has
     one, and a sitting turns on a handful of reports between a hundred votes —
     so this is a few requests, cached across the whole run, not one per vote.

     "No usable title", not "no item". An item can be published with an empty
     label, and testing for the item rather than for the title left those votes
     titled by their filing code with the answer one request away. */
  for (const vote of votes) {
    if (!vote.code) continue;
    if (english(vote.item && vote.item.activity_label).trim()) continue;
    vote.subject = plainSubject(await documentTitle(vote.code));
  }

  return votes;
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
      /* And the decision's own label decides the rest. isFinalVote reads the
         decision's fields, which is enough for the tenth term because its
         decisions carry decisionAboutId; the ninth term's do not, and mark a
         paragraph vote only by appending it — "- Recital O/2" — to the label.

         The label, not the record's title. They used to be the same thing for
         a ninth-term vote and are not any more: the title is now the report's
         subject where the label had only a filing code, and a subject never
         carries the mark. Reading the title here would let every paragraph
         vote of the term back in. */
      if (!args.all && isPartOfAText(english(vote.decision.activity_label))) {
        skipped += 1;
        continue;
      }

      const record = buildRecord(vote.decision, vote.item, members, date, vote.subject, vote.code);
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
