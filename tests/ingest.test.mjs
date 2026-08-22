/* A small check on the one piece of logic that turns other people's data into
   ours: run with `npm test`. No framework — node is enough. */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { toDecision } from '../scripts/ingest-roll-call.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const vote = JSON.parse(await readFile(path.join(here, 'fixtures/roll-call.json'), 'utf8'));
const decision = toDecision(vote);

assert.equal(decision.body, 'parliament');
assert.equal(decision.date, '2026-04-15');
assert.equal(decision.outcome.result, 'adopted');

// The Parliament calls Greece EL; this project uses the ISO code GR throughout,
// and the map has no country called EL to colour in.
assert.deepEqual(Object.keys(decision.countries).sort(), ['DE', 'FI', 'GR']);

const germany = decision.countries.DE;
assert.equal(germany.meps.length, 3);
assert.deepEqual(germany.meps.map((mep) => mep.vote).sort(), ['abstain', 'against', 'for']);
assert.deepEqual(germany.meps.map((mep) => mep.name), ['Ada Fixture', 'Bo Sample', 'Cato Placeholder']);

const epp = germany.mepGroups.find((group) => group.group === 'EPP');
assert.deepEqual(epp, { group: 'EPP', seats: 2, for: 0, against: 1, abstain: 1, absent: 0 });

// Every group row must account for exactly its own seats — the validator relies on it.
for (const country of Object.values(decision.countries)) {
  const seats = country.mepGroups.reduce((sum, group) => sum + group.seats, 0);
  assert.equal(seats, country.meps.length);
  for (const group of country.mepGroups) {
    assert.equal(group.for + group.against + group.abstain + group.absent, group.seats);
  }
}

// Impact and press are never invented by the importer.
assert.equal(decision.countries.DE.impact, null);
assert.deepEqual(decision.countries.DE.press, []);

console.log('ingest.test.mjs: ok');
