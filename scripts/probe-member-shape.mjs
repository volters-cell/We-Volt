#!/usr/bin/env node
/*
 * What does the portal actually say about a member who has left?
 *
 * Backfilling an earlier term means naming the group of several hundred people
 * who are no longer in the House. The bulk list does not carry it; the person's
 * own record should. This prints one former member's memberships in full, so
 * the field names are read off the portal rather than guessed at.
 *
 *   node scripts/probe-member-shape.mjs 197478
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, lastSegment } from './lib/portal.mjs';

/* Whoever the ninth term had that the tenth does not. Asking the portal for
   the names rather than naming anyone from memory. */
const ids = process.argv.slice(2).filter(a => /^\d+$/.test(a));
if (!ids.length) {
  const current = await getAll('/meps/show-current', {}, 1000);
  const sitting = new Set(current.map(r => String(r.identifier || lastSegment(r.id))));
  const ninth = await getAll('/meps', { 'parliamentary-term': 9 }, 1000);
  const gone = ninth.filter(r => !sitting.has(String(r.identifier || lastSegment(r.id))));
  console.log(`ninth term: ${ninth.length} members, ${gone.length} no longer sitting.\n`);
  ids.push(...gone.slice(0, 2).map(r => String(r.identifier || lastSegment(r.id))));
}

for (const id of ids) {
  console.log('='.repeat(70));
  const detail = await get(`/meps/${id}`, {});
  const person = (detail && detail.data && detail.data[0]) || null;
  if (!person) { console.log(`${id}: nothing returned`); continue; }
  console.log(`${id}  ${person.label || ''}`);
  console.log('top-level keys:', Object.keys(person).join(', '));
  const memberships = [].concat(person.hasMembership || []);
  console.log(`${memberships.length} memberships; classifications seen:`);
  const kinds = {};
  memberships.forEach(function (m) {
    const k = String(m.membershipClassification || '(none)');
    kinds[k] = (kinds[k] || 0) + 1;
  });
  Object.entries(kinds).forEach(([k, n]) => console.log(`   ${n}x ${k}`));

  /* The two that matter: the European political group they sat with, and the
     national party they were elected for. Printed whole, because these are the
     entries the import will read. */
  const wanted = memberships.filter(function (m) {
    return /EP_GROUP|POLITICAL_GROUP/i.test(String(m.membershipClassification || ''));
  });
  console.log(`\n${wanted.length} political-group memberships:`);
  wanted.forEach(function (m, i) {
    console.log(`  [${i}] ` + JSON.stringify(m, null, 2).split('\n').join('\n      '));
  });

  /* organization is an opaque "org/5575". Something has to turn that into a
     name, and these are the shapes worth trying before one is relied on. */
  const org = wanted.length ? String(wanted[0].organization || '') : '';
  const id = org.replace(/^org\//, '');
  if (id) {
    for (const shape of [`/corporate-bodies/${id}`, `/corporate-bodies/org/${id}`, `/org/${id}`]) {
      try {
        const answer = await get(shape, {});
        const row = (answer && answer.data && answer.data[0]) || answer;
        console.log(`\n  ${shape} -> ` + (row
          ? JSON.stringify(row, null, 2).slice(0, 700).split('\n').join('\n    ')
          : 'nothing'));
      } catch (error) {
        console.log(`\n  ${shape} -> FAILED ${String(error.message).slice(0, 80)}`);
      }
    }
  }
}
