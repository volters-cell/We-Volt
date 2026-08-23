/* Checks the one piece of logic that turns the Parliament's documents into
   this project's records. Run with `npm test`. No framework — node is enough. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseXML, findAll, find, decodeEntities } from '../scripts/lib/xml.mjs';
import { parseAnnex, parseDirectory, toDecision, isFinalVote, normaliseGroup, countryCode,
  parseVotList, splitTitle } from '../scripts/fetch-plenary.mjs';
import { parseCalendar, parseLocation, sittingDays } from '../scripts/fetch-sessions.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (name) => readFile(path.join(here, 'fixtures', name), 'utf8');

/* ---------------------------------------------------------------- the reader */

const doc = parseXML('<a x="1"><b>one &amp; two</b><c/><b>deep<d>er</d></b></a>');
assert.equal(doc.children[0].attributes.x, '1');
assert.deepEqual(findAll(doc, 'b').map((n) => n.text), ['one & two', 'deeper']);
assert.ok(find(doc, 'c'), 'self-closing elements are still elements');
assert.equal(decodeEntities('caf&#233; &amp; r&#xE9;sum&#233;'), 'café & résumé');

/* ------------------------------------------------------------- the directory */

const members = parseDirectory(await read('mep-directory.xml'));
assert.equal(Object.keys(members).length, 5);
assert.deepEqual(members['1001'], {
  name: 'Ada Fixture', country: 'DE', group: 'S&D', party: 'Fixture Party'
});
// The Parliament writes Greece EL; this project writes GR, and the map has no EL.
assert.equal(members['1005'].country, 'GR');
assert.equal(countryCode('EL'), 'GR');
assert.equal(countryCode('Czech Republic'), 'CZ');
assert.equal(countryCode('United Kingdom'), null, 'a former member state is not a member state');
assert.equal(normaliseGroup('Renew Europe Group'), 'Renew');
assert.equal(normaliseGroup('Some New Group'), 'Some New Group', 'unknown groups pass through');

/* ----------------------------------------------------------------- the annex */

const rollCalls = parseAnnex(await read('rcv-annex.xml'));
assert.equal(rollCalls.length, 2);

const [final, amendment] = rollCalls;
assert.match(final.title, /ensemble du texte/);
assert.equal(final.votes.length, 5);
assert.ok(isFinalVote(final.title), 'a vote on the whole text is a final vote');
assert.ok(!isFinalVote(amendment.title), 'an amendment is not');

/* --------------------------------------------------------------- the record */

const built = toDecision(final, members, '2026-09-15', 'https://example.invalid/annex.xml');
const decision = built.decision;

assert.equal(decision.body, 'parliament');
assert.equal(decision.status, 'verified');
assert.equal(decision.date, '2026-09-15');
assert.equal(decision.outcome.result, 'adopted', '3 for beats 1 against');
assert.deepEqual(built.totals, { for: 3, against: 1, abstain: 1 });
assert.deepEqual(Object.keys(decision.countries).sort(), ['DE', 'FI', 'GR']);
assert.equal(decision.procedure.reference, 'A10-0123/2026');

const germany = decision.countries.DE;
assert.equal(germany.meps.length, 3);
assert.deepEqual(germany.meps.map((mep) => mep.name), ['Ada Fixture', 'Bo Sample', 'Cato Placeholder']);
assert.deepEqual(germany.meps.map((mep) => mep.vote).sort(), ['abstain', 'against', 'for']);
assert.deepEqual(germany.mepGroups.find((g) => g.group === 'EPP'),
  { group: 'EPP', seats: 2, for: 0, against: 1, abstain: 1, absent: 0 });

// Group rows must account for exactly their own members — the validator relies on it.
for (const country of Object.values(decision.countries)) {
  const seats = country.mepGroups.reduce((sum, group) => sum + group.seats, 0);
  assert.equal(seats, country.meps.length);
  for (const group of country.mepGroups) {
    assert.equal(group.for + group.against + group.abstain + group.absent, group.seats);
  }
}

// The importer never invents the parts that are editorial.
assert.deepEqual(decision.countries.DE.press, []);
assert.equal(decision.countries.DE.impact, undefined);
assert.equal(decision.summary, '');

// A member the directory does not know is reported, not silently dropped.
const orphan = toDecision(final, {}, '2026-09-15', 'https://example.invalid/annex.xml');
assert.equal(orphan.unknown.length, 5);
assert.deepEqual(Object.keys(orphan.decision.countries), []);

/* ------------------------------------------------------------- the votes list */

const official = parseVotList(await read('vot-list.xml'));
assert.deepEqual(Object.keys(official).sort(), ['900001', '900002']);
assert.equal(official['900001'].result, 'adopted');
assert.equal(official['900002'].result, 'rejected');

// The annex counts the votes; the votes list says what carried. Where the two
// are available, the Parliament's own statement wins over our arithmetic.
const stated = toDecision(final, members, '2026-09-15', 'https://example.invalid/annex.xml',
  { result: 'rejected' }).decision;
assert.equal(stated.outcome.result, 'rejected', '3 for, 1 against — but the Parliament said no');
assert.doesNotMatch(stated.outcome.headline, /derived/);
assert.match(decision.outcome.headline, /derived/, 'without a votes list, say the result was derived');
assert.match(decision.dataNote, /derived/);
assert.match(stated.dataNote, /votes list/);

/* ---------------------------------------------------------------- the titles */

const split = splitTitle('A10-0123/2026 - Rapporteur - Proposition de résolution (ensemble du texte)');
assert.equal(split.reference, 'A10-0123/2026');
assert.equal(split.title, 'Proposition de résolution (ensemble du texte)');
assert.match(split.subtitle, /A10-0123\/2026 · Rapporteur/);

/* -------------------------------------------------------- the plenary calendar */

const sessions = parseCalendar(await read('session-calendar.json'));
// The calendar has one entry per sitting day; duplicates fold into one session.
assert.equal(sessions.length, 3);
assert.deepEqual(sessions[0], { start: '2026-07-06', end: '2026-07-09', location: null });
assert.deepEqual(sittingDays([sessions[0]]),
  ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']);
assert.ok(sessions[0].start < sessions[1].start, 'sessions come back in order');

assert.equal(parseLocation(await read('meeting.xml')), 'Strasbourg');
assert.equal(parseLocation('<rdf:RDF xmlns:rdf="x"></rdf:RDF>'), null, 'no locality, no guess');

console.log('import.test.mjs: ok');
