#!/usr/bin/env node
/*
 * Give every member a face and a party.
 *
 *   node scripts/fetch-profiles.mjs            # everyone missing either
 *   node scripts/fetch-profiles.mjs --all      # re-read everyone
 *   node scripts/fetch-profiles.mjs --limit 50 # a slice, for a first run
 *
 * The directory this project builds from the vote records carries a name, a
 * country and a political group. Two things a reader expects are missing from
 * it, and both are in the Parliament's own record of a person:
 *
 *   the portrait   person.img — the address of the official photograph, which
 *                  the Parliament publishes for every member
 *   the party      the membership classified NATIONAL_POLITICAL_GROUP whose
 *                  period has not ended. Its organisation resolves to the
 *                  party's own name (prefLabel) and the abbreviation it is
 *                  known by at home (label): "Centerpartiet", "C".
 *
 * A member's political group is the European one — Renew, EPP, The Left. The
 * party is the national one they were elected for, and the two are not the
 * same story: a reader following an Italian MEP wants to know they stood for
 * Fratelli d'Italia, not only that they sit with the ECR.
 *
 * Organisations are read once and remembered: seven hundred members share
 * about two hundred parties, so the second member of a party costs nothing.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get, lastSegment, countryCode } from './lib/portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = 'data/reference/meps.json';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
};

const NATIONAL = 'def/ep-entities/NATIONAL_POLITICAL_GROUP';

const directory = JSON.parse(await readFile(path.join(ROOT, FILE), 'utf8'));
const members = directory.members || {};
const ids = Object.keys(members);

if (!ids.length) {
  console.error(`${FILE} is empty — import some votes first.`);
  process.exit(1);
}

/* Who still needs asking. A member already carrying both is left alone, so a
   re-run after a new sitting costs a handful of requests rather than a
   thousand. --all asks again for everyone, which is what to do when a party
   has renamed itself or a member has changed one. */
const wanted = ids.filter((id) => {
  if (has('--all')) return true;
  const member = members[id];
  return !member.photo || member.party === null || member.party === undefined;
});

const limit = Number(value('--limit') || 0);
const queue = limit > 0 ? wanted.slice(0, limit) : wanted;

console.log(`${queue.length} of ${ids.length} members to read.`);

/* One organisation, read once. */
const parties = new Map();

async function party(organisation) {
  const id = lastSegment(organisation);
  if (!id) return null;
  if (parties.has(id)) return parties.get(id);

  let resolved = null;
  try {
    const body = await get(`/corporate-bodies/${id}`, {});
    const org = (body && body.data && body.data[0]) || null;
    if (org) {
      // prefLabel is the party's name, in every official language and the same
      // in all of them for a name that is a name. label is what it is called
      // on a ballot paper at home.
      const name = pick(org.prefLabel) || pick(org.altLabel) || org.label || null;
      const short = org.label && org.label !== name ? org.label : null;
      resolved = name
        ? {
            name: name,
            short: short,
            country: countryCode(lastSegment([].concat(org.represents || [])[0])) || null,
            org: id
          }
        : null;
    }
  } catch (error) {
    console.warn(`  org ${id}: ${error.message}`);
  }

  parties.set(id, resolved);
  return resolved;
}

/* A label in the portal is an object of languages. English where there is one,
   otherwise whichever the party itself uses — a national party's name is a
   name, and it is the same string in every language column. */
function pick(label) {
  if (!label) return null;
  if (typeof label === 'string') return label;
  const languages = Object.keys(label);
  if (!languages.length) return null;
  return label.en || label[languages[0]] || null;
}

/* The party a member sits for now: the national membership whose period has
   not ended. A member who has changed party mid-term has two; the open one is
   the current one. */
function currentParty(person) {
  const memberships = [].concat((person && person.hasMembership) || []);
  const national = memberships.filter((membership) =>
    membership.membershipClassification === NATIONAL && membership.organization);

  const open = national.filter((membership) =>
    !(membership.memberDuring && membership.memberDuring.endDate));
  const pool = open.length ? open : national;
  if (!pool.length) return null;

  // Latest start wins, so a member who switched shows the party they are in.
  pool.sort((a, b) => String((b.memberDuring || {}).startDate || '')
    .localeCompare(String((a.memberDuring || {}).startDate || '')));
  return pool[0].organization;
}

let photos = 0;
let named = 0;
let blank = 0;
let at = 0;

for (const id of queue) {
  at += 1;
  if (at % 50 === 0) console.log(`  ${at}/${queue.length}…`);

  let person = null;
  try {
    const body = await get(`/meps/${id}`, {});
    person = (body && body.data && body.data[0]) || null;
  } catch (error) {
    console.warn(`  ${id}: ${error.message}`);
    continue;
  }
  if (!person) continue;

  const member = members[id];

  if (typeof person.img === 'string' && person.img) {
    member.photo = person.img;
    photos += 1;
  }

  const organisation = currentParty(person);
  const found = organisation ? await party(organisation) : null;
  if (found) {
    member.party = found.name;
    if (found.short) member.partyShort = found.short;
    named += 1;
  } else {
    // Recorded as asked-and-not-there, so the next run does not ask again.
    if (member.party === undefined) member.party = null;
    blank += 1;
  }

  if (person.homepage) member.homepage = person.homepage;
}

directory.fetched = new Date().toISOString().slice(0, 10);
directory.note = 'Every member who has held a seat in this Parliament: name, ' +
  'country, political group, the national party they were elected for, and the ' +
  'address of the portrait the Parliament publishes. Vote records reference ' +
  'members by id rather than repeating this, which keeps a whole term of votes ' +
  'at tens of megabytes. Members marked former have left the House; the portal ' +
  'no longer states their group.';

await writeFile(path.join(ROOT, FILE), JSON.stringify(directory, null, 2) + '\n', 'utf8');

const withPhoto = ids.filter((id) => members[id].photo).length;
const withParty = ids.filter((id) => members[id].party).length;

console.log(`${FILE}: ${photos} portraits and ${named} parties read this run ` +
  `(${blank} with no national party in the record).`);
console.log(`  ${withPhoto} of ${ids.length} members now have a portrait, ` +
  `${withParty} a party, from ${parties.size} organisations.`);
