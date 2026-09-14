#!/usr/bin/env node
/*
 * When did each member of a followed delegation actually sit?
 *
 *   node scripts/fetch-delegation-terms.mjs
 *
 * delegations.json lists members by person id and nothing else, so every vote
 * showed every member — and on a vote of 2024 that meant four people recorded
 * as "did not vote" who were not in the Parliament at all. They had not
 * abstained; they had not been elected.
 *
 * A mandate is on the person's own record: a membership in an EU_INSTITUTION
 * organisation named org/ep-9 or org/ep-10, with the dates it ran. That shape
 * was read off the portal by scripts/probe-member-shape.mjs. This writes those
 * dates back into delegations.json so the site can show, on any vote, the
 * people who were there to cast one.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get, lastSegment } from './lib/portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = 'data/reference/delegations.json';

const doc = JSON.parse(await readFile(path.join(ROOT, FILE), 'utf8'));
let found = 0;

for (const delegation of doc.delegations || []) {
  console.log(`\n${delegation.name}`);
  for (const member of delegation.members || []) {
    const detail = await get(`/meps/${member.id}`, {});
    const person = (detail && detail.data && detail.data[0]) || null;
    const memberships = [].concat((person && person.hasMembership) || []);

    /* The seat itself, not a committee or a delegation: the Parliament as an
       institution, one membership per term served. */
    const mandates = memberships
      .filter((m) => /EU_INSTITUTION/.test(String(m.membershipClassification || '')) &&
        /^org\/ep-\d+$/.test(String(m.organization || '')))
      .map((m) => ({
        term: Number(lastSegment(String(m.organization)).replace('ep-', '')),
        from: (m.memberDuring && m.memberDuring.startDate) || null,
        until: (m.memberDuring && m.memberDuring.endDate) || null
      }))
      .filter((m) => m.from)
      .sort((a, b) => (a.from < b.from ? -1 : 1));

    member.mandates = mandates;
    found += mandates.length;
    console.log(`  ${String(member.id).padEnd(8)} ${(member.name || '').padEnd(28)} ` +
      (mandates.length
        ? mandates.map((m) => `term ${m.term}: ${m.from}..${m.until || 'present'}`).join('; ')
        : 'NO MANDATE FOUND'));
  }
}

doc.metadata = doc.metadata || {};
doc.metadata.mandatesFetched = new Date().toISOString().slice(0, 10);
doc.metadata.sources = [...new Set([].concat(doc.metadata.sources || [],
  'Mandates: the parliamentary memberships on each person at data.europarl.europa.eu/api/v2/meps/{id}'))];

await writeFile(path.join(ROOT, FILE), JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`\n${FILE}: ${found} mandate${found === 1 ? '' : 's'} written.`);
