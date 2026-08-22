#!/usr/bin/env node
/*
 * Turn a European Parliament roll-call vote into an EU Tracker decision file.
 *
 * The sample decisions in this repository are placeholders. This is how a real
 * one gets made: take a published roll-call, group it by member state, and write
 * the record with every MEP's own vote attached.
 *
 *   node scripts/ingest-roll-call.mjs --vote 168393 --out data/decisions
 *   node scripts/ingest-roll-call.mjs --file tests/fixtures/roll-call.json --out /tmp
 *
 * --vote  fetches from the HowTheyVote.eu API, which republishes the Parliament's
 *         own roll-call annexes: https://howtheyvote.eu/api/votes/<id>
 * --file  reads a response already saved to disk (offline, or for a fixture).
 *
 * The impact and press sections are left empty on purpose. Nobody should
 * generate those: an editor fills them in with sourced figures and real
 * coverage. The file this writes is a starting point, not a finished record.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const POSITION = { FOR: 'for', AGAINST: 'against', ABSTENTION: 'abstain', DID_NOT_VOTE: 'absent' };

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

async function loadVote(args) {
  if (args.file) return JSON.parse(await readFile(args.file, 'utf8'));
  if (!args.vote) {
    throw new Error('Pass --vote <id> to fetch, or --file <path> to read a saved response.');
  }
  const url = `https://howtheyvote.eu/api/votes/${args.vote}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function countryCode(member) {
  const raw = (member.country && (member.country.code || member.country.iso_alpha_2)) || '';
  // The Parliament writes Greece as EL; ISO 3166 and this project write it GR.
  return raw.toUpperCase() === 'EL' ? 'GR' : raw.toUpperCase();
}

function groupLabel(member) {
  const group = member.group || {};
  return group.short_label || group.code || group.label || 'NI';
}

export function toDecision(vote) {
  const memberVotes = vote.member_votes || vote.memberVotes || [];
  if (!memberVotes.length) throw new Error('This response carries no member votes.');

  const countries = {};
  for (const entry of memberVotes) {
    const member = entry.member || {};
    const code = countryCode(member);
    if (!code) continue;

    const position = POSITION[String(entry.position).toUpperCase()] || 'absent';
    const group = groupLabel(member);

    if (!countries[code]) countries[code] = { meps: [], mepGroups: [], impact: null, press: [] };
    const country = countries[code];

    country.meps.push({
      name: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.name || 'Unknown',
      party: member.national_party || member.party || null,
      group,
      vote: position,
      id: member.id || null
    });

    let row = country.mepGroups.find((item) => item.group === group);
    if (!row) {
      row = { group, seats: 0, for: 0, against: 0, abstain: 0, absent: 0 };
      country.mepGroups.push(row);
    }
    row.seats += 1;
    row[position] += 1;
  }

  for (const country of Object.values(countries)) {
    country.meps.sort((a, b) => a.name.localeCompare(b.name));
    country.mepGroups.sort((a, b) => b.seats - a.seats);
  }

  const date = (vote.timestamp || vote.date || '').slice(0, 10);
  const title = vote.display_title || vote.title || vote.description || 'Roll-call vote';
  const adopted = vote.result ? String(vote.result).toUpperCase() === 'ADOPTED' : null;

  return {
    id: `ep-${date.slice(0, 4)}-${slug(title)}`,
    status: 'verified',
    dataNote: `Roll-call imported from ${vote.source_url || 'the European Parliament roll-call annex'}` +
      ` on ${new Date().toISOString().slice(0, 10)}. Impact and press sections are filled in by editors.`,
    body: 'parliament',
    bodyLabel: 'European Parliament',
    title,
    subtitle: vote.procedure_title || vote.subtitle || 'Roll-call vote in plenary',
    date,
    voteRule: 'simple-majority',
    voteRuleLabel: 'Majority of votes cast',
    procedure: {
      reference: (vote.procedure && vote.procedure.reference) || vote.reference || null,
      url: (vote.procedure && vote.procedure.url) || null
    },
    summary: vote.description || '',
    whatItMeans: [],
    outcome: {
      result: adopted === null ? 'recorded' : (adopted ? 'adopted' : 'rejected'),
      headline: adopted === null
        ? 'Result not stated in the source record.'
        : (adopted ? 'Adopted.' : 'Rejected.')
    },
    impactUnit: 'EUR per person per year',
    impactLabel: 'Estimated net budget effect',
    sources: [
      { label: 'Roll-call record (HowTheyVote.eu)', url: vote.url || `https://howtheyvote.eu/votes/${vote.id}` },
      { label: 'European Parliament open data', url: 'https://data.europarl.europa.eu/' }
    ],
    countries
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const decision = toDecision(await loadVote(args));

  const outDir = typeof args.out === 'string' ? args.out : 'data/decisions';
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${decision.id}.json`);
  await writeFile(outPath, JSON.stringify(decision, null, 2) + '\n', 'utf8');

  const states = Object.keys(decision.countries).length;
  const meps = Object.values(decision.countries).reduce((sum, c) => sum + c.meps.length, 0);
  console.log(`${outPath}: ${meps} MEPs across ${states} member states`);
  if (states !== 27) {
    console.warn(`Note: ${states} member states in this record, not 27 — check the source.`);
  }
  console.log('Next: add the impact figures and the press cards, then run scripts/validate-data.mjs');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
