#!/usr/bin/env node
/*
 * Checks every decision file against the rules in docs/DATA-MODEL.md before it
 * is published. Run it locally, and let CI run it on every pull request:
 *
 *   node scripts/validate-data.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const BODIES = ['parliament', 'council', 'commission'];
const POSITIONS = ['for', 'against', 'abstain', 'absent', 'not-applicable'];
const FRAMINGS = ['supportive', 'critical', 'mixed', 'neutral'];
const VOTE_KEYS = ['for', 'against', 'abstain', 'absent'];

const problems = [];
const notes = [];

function fail(file, message) { problems.push(`${file}: ${message}`); }
function note(file, message) { notes.push(`${file}: ${message}`); }

async function readJSON(relative) {
  return JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
}

function checkDecision(file, decision, states) {
  const seats = Object.fromEntries(states.map((s) => [s.code, s.seats]));
  const codes = Object.keys(seats);

  ['id', 'body', 'title', 'date', 'summary', 'outcome'].forEach((key) => {
    if (!decision[key]) fail(file, `missing "${key}"`);
  });
  if (!BODIES.includes(decision.body)) fail(file, `body must be one of ${BODIES.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decision.date || '')) fail(file, 'date must be YYYY-MM-DD');
  if (!['sample', 'verified'].includes(decision.status)) fail(file, 'status must be "sample" or "verified"');
  if (decision.status === 'sample' && !decision.dataNote) {
    fail(file, 'a sample record must carry a dataNote saying so — readers have to be able to tell');
  }
  if (!Array.isArray(decision.sources) || !decision.sources.length) {
    fail(file, 'every decision needs at least one source');
  }

  const countries = decision.countries || {};
  const missing = codes.filter((code) => !countries[code]);
  if (missing.length) fail(file, `no entry for ${missing.join(', ')} — all 27 member states must appear`);
  Object.keys(countries).filter((code) => !seats[code])
    .forEach((code) => fail(file, `"${code}" is not an EU member state code`));

  Object.entries(countries).forEach(([code, country]) => {
    const where = `${file} [${code}]`;

    if (country.position && !POSITIONS.includes(country.position)) {
      fail(where, `position "${country.position}" is not one of ${POSITIONS.join(', ')}`);
    }
    if (decision.body === 'council' && !country.position) {
      fail(where, 'a Council decision needs a recorded position for every member state');
    }

    if (Array.isArray(country.mepGroups) && country.mepGroups.length) {
      let total = 0;
      country.mepGroups.forEach((group) => {
        if (!group.group) fail(where, 'a group row has no group name');
        const cast = VOTE_KEYS.reduce((sum, key) => sum + (group[key] || 0), 0);
        if (cast !== group.seats) {
          fail(where, `group ${group.group}: votes total ${cast} but the group holds ${group.seats} seats`);
        }
        total += group.seats || 0;
      });
      if (total !== seats[code]) {
        fail(where, `group seats total ${total}, but ${code} holds ${seats[code]} seats`);
      }
    }

    if (Array.isArray(country.meps) && country.meps.length) {
      if (country.meps.length !== seats[code]) {
        note(where, `${country.meps.length} MEPs listed, ${seats[code]} seats — check for vacancies`);
      }
      country.meps.forEach((mep) => {
        if (!mep.name) fail(where, 'an MEP row has no name');
        if (!VOTE_KEYS.includes(mep.vote)) fail(where, `MEP "${mep.name}" has vote "${mep.vote}"`);
      });
    }

    if (country.impact && country.impact.value != null && typeof country.impact.value !== 'number') {
      fail(where, 'impact.value must be a number');
    }
    if (country.impact && typeof country.impact.value === 'number' && !country.impact.note) {
      fail(where, 'an impact figure needs a note explaining what it measures');
    }

    (country.press || []).forEach((item) => {
      if (!item.outlet) fail(where, 'a press item has no outlet');
      if (!item.headline) fail(where, 'a press item has no headline');
      if (!FRAMINGS.includes(item.framing)) {
        fail(where, `press framing "${item.framing}" is not one of ${FRAMINGS.join(', ')}`);
      }
      if (decision.status === 'verified' && !item.url) {
        note(where, `press item "${item.headline}" has no link`);
      }
      if (decision.status === 'verified' && item.sample) {
        fail(where, `press item "${item.headline}" is still flagged as a sample`);
      }
    });
  });
}

function checkGeometry(file, geo, states) {
  const drawn = geo.features
    .filter((feature) => feature.properties.member !== false)
    .map((feature) => feature.properties.code)
    .sort();
  const expected = states.map((state) => state.code).sort();
  if (drawn.join() !== expected.join()) {
    fail(file, 'the map outline and the member-state list disagree');
  }
}

const reference = await readJSON('data/reference/member-states.json');
const states = reference.states;

if (states.length !== 27) fail('member-states.json', `${states.length} member states listed, expected 27`);
const totalSeats = states.reduce((sum, state) => sum + state.seats, 0);
if (totalSeats !== 720) fail('member-states.json', `seats total ${totalSeats}, expected 720`);

checkGeometry('eu-countries.geo.json', await readJSON('data/eu-countries.geo.json'), states);

const index = await readJSON('data/decisions/index.json');
for (const entry of index.decisions) {
  const decision = await readJSON(entry.file);
  if (decision.id !== entry.id) fail(entry.file, `id "${decision.id}" does not match the index entry "${entry.id}"`);
  checkDecision(path.basename(entry.file), decision, states);
}

notes.forEach((message) => console.log(`note  ${message}`));
if (problems.length) {
  problems.forEach((message) => console.error(`FAIL  ${message}`));
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log(`OK — ${index.decisions.length} decisions, ${states.length} member states, ${totalSeats} seats.`);
