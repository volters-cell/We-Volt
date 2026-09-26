/* Checks the one piece of logic that turns the Parliament's records into this
   project's. The fixtures are cut down from real answers of the open data
   portal, so a change in its shape shows up here rather than on the site.
   Run with `npm test`. No framework — node is enough. 

   SPDX-License-Identifier: AGPL-3.0-or-later
*/

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
import { sittingOn, dayAfter } from '../scripts/sitting-day.mjs';
import { shorten } from '../scripts/lib/titles.mjs';
import { opensOnOeil } from '../scripts/lib/ep-sources.mjs';
import { bulletsFrom, operativeParagraphs, isProcedural } from '../scripts/lib/operative.mjs';

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
/* This asserted null, on the reasoning that a former member state is not a
   member state. True, and it erased the 73 members the United Kingdom sent to
   the ninth term — whose votes are now held here, and have to belong to
   somebody. It is a member state on the days it sat. */
assert.equal(countryCode('GBR'), 'GB', 'the United Kingdom sat until 31 January 2020');
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
/* A record stays small because the identities live in the directory and the
   ballots are [id, position] pairs — not because it is shy about saying where
   it came from. The four provenance links cost about 450 characters once, per
   record; the guard is here to catch a name or a country creeping in beside
   every ballot, and at this size it still does. */
assert.ok(JSON.stringify(record).length < 1900, 'a record stays small');
assert.ok(!/\bname\b/.test(JSON.stringify(record.ballots)), 'ballots carry no names');

// The importer never invents the parts that are editorial.
assert.equal(record.summary, '');
assert.deepEqual(record.whatItMeans, []);

// The source is named: the open data the record was read from.
/* A record names the documents it can be checked against, not the portal's
   front door. The roll-call results lead — that is the document the vote is
   recorded in — and the machine-readable data this project counted from is
   still there, at the end, for anyone recounting it. */
assert.ok(record.sources.length >= 3, 'a record cites at least three places');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)));
assert.equal(record.sources[0].role, 'record');
assert.match(record.sources[0].url, /europarl\.europa\.eu\/doceo\/document\/PV-\d+-\d{4}-\d{2}-\d{2}-RCV_EN\.html/);
assert.ok(record.sources.some((source) => /data\.europarl\.europa\.eu/.test(source.url)),
  'the data it was read from is still cited');
assert.ok(record.sources.every((source) => source.label && source.role));

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

/* The schedule reads the Parliament's calendar instead of guessing at Monday
   to Thursday, so the reading has to be right at every edge: the first day, the
   last day, the grace day after it, and the day past that. And it has to say
   yes when it cannot tell, because importing on a quiet day writes nothing
   while missing a sitting loses a day of votes. */
const calendar = [
  { start: '2026-09-14', end: '2026-09-17', location: 'Strasbourg' },
  { start: '2026-10-07', end: '2026-10-08', location: 'Brussels' },
  { start: '2026-11-03', end: '2026-11-03', location: 'Brussels' }
];
assert.equal(sittingOn('2026-09-13', calendar).sitting, false, 'the day before is not a sitting');
assert.equal(sittingOn('2026-09-14', calendar).sitting, true, 'the first day is');
assert.equal(sittingOn('2026-09-17', calendar).sitting, true, 'the last day is');
assert.equal(sittingOn('2026-09-18', calendar).sitting, true, 'the day after is, for the late details');
assert.equal(sittingOn('2026-09-19', calendar).sitting, false, 'two days after is not');
assert.equal(sittingOn('2026-11-03', calendar).sitting, true, 'a one-day session is');
assert.equal(sittingOn('2026-11-04', calendar).sitting, true, 'and its grace day');
// A month into the future of the last session: the calendar is stale, so import.
assert.equal(sittingOn('2026-12-20', calendar).sitting, true, 'a stale calendar means yes');
assert.equal(sittingOn('2026-09-19', []).sitting, true, 'no calendar means yes');
assert.equal(sittingOn('2026-09-19', null).sitting, true, 'an unreadable calendar means yes');
assert.equal(dayAfter('2026-12-31'), '2027-01-01', 'the grace day crosses the year');
assert.equal(dayAfter('2028-02-28'), '2028-02-29', 'and the leap day');

/* A card is read by running down it, so a headline has to start with its
   subject. These are the openings that stood in the way of that. */
assert.equal(shorten('Council decision on guidelines for the employment policies of the Member States'),
  'Guidelines for the employment policies of the Member States', 'the instrument and its preposition go');
assert.equal(shorten('Council regulation establishing the Instrument for Nuclear Safety Cooperation'),
  'Establishing the Instrument for Nuclear Safety Cooperation', 'the instrument goes, the verb stays');
assert.equal(shorten('Regulation amending the Multiannual financial framework 2014-2020'),
  'Amending the Multiannual financial framework 2014-2020', 'a vote amending a thing is not the thing');
assert.equal(shorten('The progressive resumption of tourism services in the EU'),
  'Progressive resumption of tourism services in the EU', 'no headline opens on "The"');
assert.equal(shorten('Amending Regulation (EU) 2017/2107 laying down management measures'),
  'Amending Regulation (EU) 2017/2107 laying down management measures', 'a good title is left alone');
assert.equal(shorten('The EU'), 'The EU', 'and a title with nothing to spare keeps its article');

/* The United Kingdom sat in the ninth term and this archive holds 26 of its
   sitting days. Mapping it to null erased 74 members, whose ballots then
   counted as nobody's. */
assert.equal(countryCode('GBR'), 'GB', 'the portal spells it GBR');
assert.equal(countryCode('UK'), 'GB', 'the Union spells it UK');
assert.equal(countryCode('EL'), 'GR', 'and Greece EL, which ISO spells GR');
assert.equal(countryCode('ZZZ'), null, 'a country nobody uses is still nothing');

/* A former member state is named and nothing more: these figures feed the
   qualified-majority arithmetic and the seat counts, and a state that has left
   takes no part in either. */
const reference = JSON.parse(await readFile(new URL('../data/reference/member-states.json', import.meta.url), 'utf8'));
assert.equal(reference.states.length, 27, 'the sitting Parliament is still 27 states');
assert.ok(reference.former.length >= 1, 'and the ones that left are recorded apart from them');
for (const state of reference.former) {
  assert.ok(state.code && state.name, 'a former state has a code and a name');
  assert.equal(state.seats, undefined, 'and claims no seats');
  assert.equal(state.population, undefined, 'and no population');
  assert.equal(state.memberships, undefined, 'and no memberships');
  assert.ok(!reference.states.some((row) => row.code === state.code), 'and is not also a member');
}

/* Which references the Legislative Observatory answers for, established by
   opening one of each in a browser rather than by reasoning about it. Half
   this site's "check it at the European Parliament" links used to open Error
   404, which is the one kind of broken link this project cannot afford. */
assert.equal(opensOnOeil('2024/2721(RSP)'), true, 'a procedure reference with its type');
assert.equal(opensOnOeil('2024/0159M(NLE)'), true, 'including the M form');
assert.equal(opensOnOeil('A9-0002/2020'), true, 'a report code, which OEIL resolves');
assert.equal(opensOnOeil('C9-0161/2020'), true, 'and a Council one');
assert.equal(opensOnOeil('2019/0806'), false, 'a procedure number with no type: 404');
assert.equal(opensOnOeil('RC-B9-0006/2019'), false, 'a joint motion: 404');
assert.equal(opensOnOeil(''), false, 'and nothing is not a reference');

/* Three of the Parliament's own sentences under a vote, chosen by a rule
   anybody can apply to the same document and get the same three back. */
const motion = [
  'MOTION FOR A RESOLUTION on search and rescue in the Mediterranean',
  '– having regard to the Geneva Convention of 1951, in particular Article 33 thereof,',
  '1. Welcomes the Commission proposal on search and rescue and looks forward to further work;',
  '3. Calls on Member States and Frontex to step up their efforts in support of search and rescue;',
  '6. Recalls that Member States shall take the measures necessary to ensure that infringements are punishable;',
  '9. Calls on Member States to maintain their ports open to NGO vessels;'
].join('\n');

const asks = bulletsFrom(motion);
assert.equal(asks.length, 3, 'three bullets');
/* Demands first, and among them the one a reader takes in at a glance: the
   66-character paragraph says as much as the 96-character one above it. */
assert.ok(/^Calls on Member States to maintain/.test(asks[0]),
  'the shorter demand leads');
assert.ok(/^Calls on Member States and Frontex/.test(asks[1]),
  'the longer demand follows it');
assert.ok(/^Recalls|^Welcomes/.test(asks[2]),
  'and both demands outrank what the Parliament merely observes');
assert.ok(asks.every((line) => !/^\d/.test(line)), 'the paragraph number comes off');
assert.ok(asks.every((line) => !/[;]$/.test(line)), 'and the closing semicolon');
assert.ok(!asks.some((line) => /having regard/.test(line)), 'a recital is not something a vote asks for');

/* A legislative consent asks for nothing: it approves a text. Quoting it is
   not possible and inventing something is not allowed, so it yields nothing. */
assert.deepEqual(bulletsFrom('DRAFT LEGISLATIVE RESOLUTION\n– having regard to the draft Council decision,'),
  [], 'a document with no operative paragraph gives no bullets');
assert.deepEqual(bulletsFrom(''), [], 'and neither does an empty one');

// A paragraph the length of a page is not a bullet; it stays in the document.
const huge = '4. Calls on the Commission ' + 'to consider every possible aspect '.repeat(20) + ';';
assert.deepEqual(operativeParagraphs(huge), [], 'a half-page paragraph is left where it is');

/* What the Parliament does with the paper is not what the vote asks for.
   These formulas close almost every resolution it passes — 564 of the first
   1,378 bullets, 41%, were one of them. */
assert.equal(isProcedural('Instructs its President to forward this resolution to the Council'), true);
assert.equal(isProcedural('Instructs its President to forward its position to the Commission'), true);
assert.equal(isProcedural('Calls on the Commission to refer the matter to Parliament if it intends to amend its proposal'), true);
assert.equal(isProcedural('Calls on the Council to notify Parliament if it intends to depart from the text approved'), true);
assert.equal(isProcedural('Calls on Member States to maintain their ports open to NGO vessels'), false,
  'and a real demand is not procedural');
assert.equal(isProcedural('Urges the Commission to withdraw its draft implementing regulation'), false);

assert.deepEqual(
  bulletsFrom(['1. Instructs its President to forward this resolution to the Council;',
    '2. Calls on Member States to maintain their ports open to NGO vessels;'].join('\n')),
  ['Calls on Member States to maintain their ports open to NGO vessels'],
  'the closing formula is dropped and the demand kept');

/* A paragraph ending on a colon opens a list and says nothing without it.
   Sorting by length put those at the very top, which is how "Calls on the
   Commission and the agencies to:" became a summary of a vote. */
assert.deepEqual(bulletsFrom('4. Calls on the Commission and the agencies to:'), [],
  'the opening line of a list is not a bullet');
assert.deepEqual(bulletsFrom('7. Calls on the EIB to implement the recommendations, namely'), [],
  'and neither is a sentence that trails off into one');
assert.deepEqual(bulletsFrom('5. Calls on the Member States to effectively combat child poverty;'),
  ['Calls on the Member States to effectively combat child poverty'],
  'a complete short sentence is exactly what is wanted');

/* Canada is drawn in an inset, and an inset must never cost the Union an
   inch: the frame is fitted to the member states, and a box of somewhere else
   takes no part in fitting it. Laid out with and without Canada, every member
   state has to land on exactly the same pixels. */
{
  const { default: vm } = await import('node:vm');
  const context = { window: {}, Math };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL('../assets/js/projection.js', import.meta.url), 'utf8'), context);
  const Projection = context.window.Projection;
  const geo = JSON.parse(await readFile(new URL('../data/eu-countries.geo.json', import.meta.url), 'utf8'));
  const withoutCanada = { type: geo.type, features: geo.features.filter((f) => f.properties.code !== 'CA') };

  const paths = (collection, wide) => Object.fromEntries(
    Projection.layout(collection, 760, 700, 12, { insets: true, wide: wide }).shapes
      .filter((shape) => shape.member).map((shape) => [shape.code, shape.path]));
  assert.deepEqual(paths(geo, false), paths(withoutCanada, false),
    'adding an inset moves or resizes no member state by a single pixel, on a phone');
  assert.deepEqual(paths(geo, true), paths(withoutCanada, true),
    'or on a laptop');

  // On a laptop Canada sits at the left side of the map, below Greenland and
  // level with the United Kingdom; on a phone, below Spain.
  const laid = (wide) => Projection.layout(geo, 760, 700, 12, { insets: true, wide: wide }).shapes;
  const where = (wide) => laid(wide).find((shape) => shape.code === 'CA').inset;
  const extent = (code) => {
    const ys = [...laid(true).find((shape) => shape.code === code).path
      .matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map((match) => Number(match[1]));
    return { top: Math.min(...ys), bottom: Math.max(...ys) };
  };
  assert.ok(where(true).x < 40, 'on a laptop, at the left side');
  assert.ok(where(true).y > extent('GL').bottom && where(true).y > extent('IS').bottom,
    'below Greenland and Iceland');
  const middle = where(true).y + where(true).h / 2;
  assert.ok(middle > extent('GB').top && middle < extent('GB').bottom, 'level with the United Kingdom');
  assert.ok(where(false).y > 550, 'on a phone, in the corner below Spain');

  const drawn = Projection.layout(geo, 760, 700, 12, { insets: true }).shapes;
  const canada = drawn.find((shape) => shape.code === 'CA');
  assert.ok(canada && canada.inset, 'the map draws Canada, in an inset');
  assert.ok(canada.inset.x >= 0 && canada.inset.x + canada.inset.w <= 760, 'inside the frame');

  // The story card and the preview pictures do not ask for insets.
  assert.ok(!Projection.layout(geo, 400, 470, 6).shapes.some((shape) => shape.code === 'CA'),
    'and the cards, laid out by hand without it, are drawn as they were');
}

console.log('import.test.mjs: ok');
