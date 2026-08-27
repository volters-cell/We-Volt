#!/usr/bin/env node
/*
 * Rebuild data/decisions/index.json from the decision files themselves, newest
 * first. Run it after adding or editing a decision so the tracker feed and the
 * picker never drift from what is actually in the folder.
 *
 *   node scripts/build-index.mjs
 *
 * It also writes assets/groups/logos.json, the list of political group logos
 * that have actually been added. Without it the page has to guess, and a guess
 * means a browser console full of 404s for the eight groups whose logo nobody
 * has dropped in yet.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = 'data/decisions';

const files = (await readdir(path.join(ROOT, DIR)))
  .filter((name) => name.endsWith('.json') && name !== 'index.json');

const decisions = [];
for (const name of files) {
  const decision = JSON.parse(await readFile(path.join(ROOT, DIR, name), 'utf8'));
  // Everything search should match on, flattened once here so the page does
  // not have to load every record to find one.
  // The institution is deliberately not in here: it is identical on every
  // record of a body, so including it made "euro" match all 614 votes through
  // "European Parliament". The filters cover institution already.
  const keywords = [
    decision.title,
    decision.subtitle,
    decision.summary,
    (decision.procedure && decision.procedure.reference) || '',
    ...(decision.whatItMeans || [])
  ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

  decisions.push({
    id: decision.id,
    sourceId: decision.sourceId || null,
    title: decision.title,
    subtitle: decision.subtitle || '',
    date: decision.date,
    body: decision.body,
    bodyLabel: decision.bodyLabel,
    voteRuleLabel: decision.voteRuleLabel || '',
    result: (decision.outcome && decision.outcome.result) || 'recorded',
    status: decision.status,
    mepCount: Array.isArray(decision.ballots)
      ? decision.ballots.length
      : Object.values(decision.countries || {})
          .reduce((sum, country) => sum + ((country.meps || []).length), 0),
    keywords: keywords,
    file: `${DIR}/${name}`
  });
}

decisions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));

const index = {
  metadata: {
    project: 'EU Tracker',
    updated: new Date().toISOString().slice(0, 10),
    dataStatus: 'Roll-call votes of the European Parliament, from its open data portal. ' +
      'Summaries are editorial and may be absent. See about.html.'
  },
  decisions
};

await writeFile(path.join(ROOT, DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`index.json — ${decisions.length} decisions, newest ${decisions[0].date}`);

/* Which group logos exist. Drop a file into assets/groups/ and run this. */
const GROUP_DIR = 'assets/groups';
let logos = [];
try {
  logos = (await readdir(path.join(ROOT, GROUP_DIR)))
    .filter((name) => /\.(svg|png)$/i.test(name))
    .sort();
} catch (error) {
  logos = [];
}
await writeFile(path.join(ROOT, GROUP_DIR, 'logos.json'), JSON.stringify(logos) + '\n', 'utf8');
console.log(`${GROUP_DIR}/logos.json — ${logos.length} logo${logos.length === 1 ? '' : 's'}`);
