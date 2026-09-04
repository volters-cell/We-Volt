/* Checks the one piece of logic that turns the Parliament's records into this
   project's. The fixtures are cut down from real answers of the open data
   portal, so a change in its shape shows up here rather than on the site.
   Run with `npm test`. No framework — node is enough. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  normaliseGroup, countryCode, lastSegment, english, isRollCall, ballotsOf, tallyOf
} from '../scripts/lib/portal.mjs';
import {
  buildRecord, isFinalVote, procedureReference, documentReference, voteRuleOf, outcomeOf, slug,
  plainTitle
} from '../scripts/fetch-plenary.mjs';
import { foldSessions, locationOf, termNumber } from '../scripts/fetch-sessions.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = async (name) => JSON.parse(await readFile(path.join(here, 'fixtures', name), 'utf8'));

const decisions = (await read('decisions.json')).data;
const items = (await read('vote-results.json')).data;
const meetings = (await read('meetings.json')).data;
const members = await read('members.json');

const [finalVote, amendment, showOfHands] = decisions;
const item = items[0];

/* ------------------------------------------------------------ reading names */

assert.equal(lastSegment('person/197628'), '197628');
assert.equal(lastSegment('http://publications.europa.eu/resource/authority/country/FRA'), 'FRA');
assert.equal(english({ fr: 'Vote final', en: 'Final vote' }), 'Final vote');
assert.equal(english({ fr: 'Vote final' }), 'Vote final', 'any language beats none');
assert.equal(english(null), '');

// The Parliament writes Greece EL and its groups its own way; this project has
// one spelling for each, and the map has no EL.
assert.equal(countryCode('FRA'), 'FR');
assert.equal(countryCode('GRC'), 'GR');
assert.equal(countryCode('EL'), 'GR');
assert.equal(countryCode('GBR'), null, 'a former member state is not a member state');
assert.equal(normaliseGroup('PPE'), 'EPP');
assert.equal(normaliseGroup('Verts/ALE'), 'Greens/EFA');
assert.equal(normaliseGroup('Some New Group'), 'Some New Group', 'unknown groups pass through');

/* ---------------------------------------------------------------- the votes */

assert.ok(isRollCall(finalVote), 'an electronic roll call is a roll call');
assert.ok(!isRollCall(showOfHands), 'a show of hands names nobody, so it is not one');

assert.deepEqual(tallyOf(finalVote), { for: 3, against: 1, abstain: 1 });
const ballots = ballotsOf(finalVote);
assert.equal(ballots.length, 5);
assert.deepEqual(ballots[0], [1001, 0], '[member id, 0 = for]');
assert.deepEqual(ballots.find((ballot) => ballot[0] === 1003), [1003, 1], '1 = against');
assert.deepEqual(ballots.find((ballot) => ballot[0] === 1005), [1005, 2], '2 = abstain');
assert.deepEqual(ballots.map((ballot) => ballot[0]).slice().sort((a, b) => a - b),
  ballots.map((ballot) => ballot[0]), 'ballots come back in member order');

// The whole text, or one amendment to it. The portal marks an amendment by the
// thing it amends, so this is read from the record rather than from its wording.
assert.ok(isFinalVote(finalVote));
assert.ok(!isFinalVote(amendment));

/* -------------------------------------------------------------- references */

assert.equal(procedureReference('eli/dl/proc/2023-0212'), '2023/0212');
assert.equal(documentReference('eli/dl/doc/A-10-2026-0185'), 'A10-0185/2026');
assert.equal(procedureReference('eli/dl/doc/A-10-2026-0185'), null);
assert.equal(slug('2023/0212'), '2023-0212');

assert.equal(voteRuleOf('(Majority of votes cast required)').rule, 'simple-majority');
assert.equal(voteRuleOf('(Majority of Parliament\'s component Members)').rule, 'absolute-majority');

assert.equal(outcomeOf(amendment), 'rejected', 'the portal stated this one');
assert.equal(outcomeOf(finalVote), null, 'and did not state this one');

/* --------------------------------------------------------------- a record */

const record = buildRecord(finalVote, item, members, '2026-07-09');

assert.equal(record.body, 'parliament');
assert.equal(record.status, 'verified');
assert.equal(record.date, '2026-07-09');
assert.equal(record.sourceId, 195719);
assert.equal(record.id, 'ep-2026-07-09-2023-0212-195719');
assert.equal(record.title, 'Establishment of the digital euro',
  'the item gives the record its readable title, without the clerk\'s marking');

// *** is consent, ***I ***II ***III the readings of the ordinary legislative
// procedure, * consultation. None of it means anything to a reader, and the
// record keeps the procedure in its own field.
assert.equal(plainTitle('Air passenger rights ***III'), 'Air passenger rights');
assert.equal(plainTitle('EU-Morocco Agreement: amendment ***'), 'EU-Morocco Agreement: amendment');
assert.equal(plainTitle('Consultation of somebody *'), 'Consultation of somebody');
assert.equal(plainTitle('An asterisk*inside a word stays'), 'An asterisk*inside a word stays');
assert.equal(record.procedure.reference, '2023/0212');
assert.equal(record.voteRuleLabel, 'Majority of votes cast');
assert.equal(record.outcome.result, 'adopted', '3 for beats 1 against');
assert.match(record.outcome.headline, /derived/, 'and the record says the result was derived');
assert.match(record.dataNote, /follows from the totals/);
assert.equal(record._counted, 5, 'every voter was found in the directory');

// Where the Parliament states the result, its word stands over the arithmetic.
const stated = buildRecord(amendment, item, members, '2026-07-09');
assert.equal(stated.outcome.result, 'rejected');
assert.doesNotMatch(stated.outcome.headline, /derived/);
assert.doesNotMatch(stated.dataNote, /follows from the totals/);
assert.match(stated.subtitle, /Article 3/, 'an amendment says which part it changed');

// The identities live in the directory; a record stores only [id, position].
assert.deepEqual(record.countries, {}, 'identities are not repeated per record');
assert.ok(JSON.stringify(record).length < 1400, 'a record stays small');

// The importer never invents the parts that are editorial.
assert.equal(record.summary, '');
assert.deepEqual(record.whatItMeans, []);

// The source is named: the open data the record was read from.
assert.equal(record.sources.length, 1);
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)));
assert.match(record.sources[0].url, /data\.europarl\.europa\.eu/);

// A member the directory does not know is counted, not silently dropped.
assert.equal(buildRecord(finalVote, item, {}, '2026-07-09')._counted, 0);

/* ------------------------------------------------------- the plenary calendar */

assert.equal(locationOf(meetings[0]), 'Strasbourg');
assert.equal(locationOf(meetings[3]), 'Brussels');
assert.equal(locationOf({}), null, 'no locality, no guess');

// The portal names a term "org/ep-10"; reading that as a number gives NaN, and
// every sitting of the term gets filtered away.
assert.equal(termNumber('org/ep-10'), 10);
assert.equal(termNumber(meetings[0].parliamentary_term), 10);
assert.equal(termNumber(null), null);

const days = meetings
  .filter((meeting) => meeting.had_activity_type.indexOf('PLENARY') !== -1)
  .map((meeting) => ({ date: meeting.activity_date, location: locationOf(meeting) }));
const sessions = foldSessions(days);
assert.equal(sessions.length, 2, 'consecutive sitting days are one session');
assert.deepEqual(sessions[0], { start: '2026-07-06', end: '2026-07-08', location: 'Strasbourg', days: 3 });
assert.deepEqual(sessions[1], { start: '2026-07-22', end: '2026-07-22', location: 'Brussels', days: 1 });
assert.ok(sessions[0].start < sessions[1].start, 'sessions come back in order');

/* ------------------------------------------------- expanding the short form */

// data.js runs in the browser; load it here with a stand-in for window so the
// expansion the whole page depends on is actually covered.
const shim = { matchMedia: () => ({ matches: false }) };
new Function('window', await readFile(path.join(here, '../assets/js/data.js'), 'utf8'))(shim);

const expanded = shim.Data.expandBallots(JSON.parse(JSON.stringify(record)), members);
assert.deepEqual(Object.keys(expanded.countries).sort(), ['DE', 'FI', 'GR']);
assert.equal(expanded.countries.DE.meps.length, 3);
assert.deepEqual(expanded.countries.DE.meps.map((mep) => mep.name),
  ['Ada Fixture', 'Bo Sample', 'Cato Placeholder']);
assert.deepEqual(expanded.countries.DE.mepGroups.find((group) => group.group === 'EPP'),
  { group: 'EPP', seats: 2, for: 1, against: 1, abstain: 0, absent: 0 });
assert.equal(expanded.expanded.unknown, 0);

// Group rows must account for exactly their own members — the validator relies on it.
for (const country of Object.values(expanded.countries)) {
  const seats = country.mepGroups.reduce((sum, group) => sum + group.seats, 0);
  assert.equal(seats, country.meps.length);
  for (const group of country.mepGroups) {
    assert.equal(group.for + group.against + group.abstain + group.absent, group.seats);
  }
}

// A ballot for somebody the directory has never heard of is counted, not crashed on.
const orphaned = shim.Data.expandBallots({ ballots: [[999999, 0]], countries: {} }, members);
assert.equal(orphaned.expanded.unknown, 1);
assert.deepEqual(Object.keys(orphaned.countries), []);

console.log('import.test.mjs: ok');
