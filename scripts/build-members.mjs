#!/usr/bin/env node
/*
 * Turn the votes inside out: one file per member, listing how they voted on
 * every roll-call the site holds.
 *
 *   node scripts/build-members.mjs
 *
 * The vote records answer "who voted how on this". A reader following a
 * particular MEP asks the opposite — "how did this person vote on everything" —
 * and answering that from the vote files would mean downloading all of them.
 * So it is precomputed here: data/meps/<id>.json for each member, plus
 * data/meps/index.json for the search.
 *
 * Each entry is [vote id, position] against the member directory, which keeps a
 * member's whole term at a few kilobytes and the whole Parliament at a few
 * megabytes of static files.
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'data/meps';
const POSITIONS = ['for', 'against', 'abstain', 'absent'];

const read = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

const directory = (await read('data/reference/meps.json')).members || {};
if (!Object.keys(directory).length) {
  console.error('data/reference/meps.json is empty — import some votes first.');
  process.exit(1);
}

const files = (await readdir(path.join(ROOT, 'data/decisions')))
  .filter((name) => name.endsWith('.json') && name !== 'index.json');

const byMember = new Map();
let counted = 0;

for (const name of files) {
  const decision = await read(`data/decisions/${name}`);
  if (!Array.isArray(decision.ballots)) continue;
  const voteId = decision.sourceId || decision.id;

  for (const [memberId, position] of decision.ballots) {
    if (!byMember.has(memberId)) byMember.set(memberId, []);
    byMember.get(memberId).push([voteId, position]);
    counted += 1;
  }
}

await rm(path.join(ROOT, OUT), { recursive: true, force: true });
await mkdir(path.join(ROOT, OUT), { recursive: true });

const index = [];

for (const [memberId, votes] of byMember) {
  const member = directory[memberId];
  if (!member) continue;

  votes.sort((a, b) => b[0] - a[0]); // newest first, which is how they are read

  const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
  votes.forEach(([, position]) => { totals[POSITIONS[position]] += 1; });

  await writeFile(path.join(ROOT, OUT, `${memberId}.json`), JSON.stringify({
    id: memberId,
    name: member.name,
    country: member.country,
    group: member.group,
    party: member.party || null,
    totals: totals,
    votes: votes
  }) + '\n', 'utf8');

  index.push({
    id: memberId,
    name: member.name,
    country: member.country,
    group: member.group,
    votes: votes.length,
    // What search matches on, lowercased once here rather than on every keystroke.
    keywords: [member.name, member.group, member.party, member.country]
      .filter(Boolean).join(' ').toLowerCase()
  });
}

index.sort((a, b) => a.name.localeCompare(b.name));

await writeFile(path.join(ROOT, OUT, 'index.json'), JSON.stringify({
  metadata: {
    updated: new Date().toISOString().slice(0, 10),
    note: 'One file per member alongside this one, listing every vote they cast.'
  },
  members: index
}) + '\n', 'utf8');

console.log(`${OUT} — ${index.length} members, ${counted.toLocaleString('en-GB')} ballots indexed`);
