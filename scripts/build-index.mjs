#!/usr/bin/env node
/*
 * Rebuild data/decisions/index.json from the decision files themselves, newest
 * first. Run it after adding or editing a decision so the tracker feed and the
 * picker never drift from what is actually in the folder.
 *
 *   node scripts/build-index.mjs
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
  decisions.push({
    id: decision.id,
    title: decision.title,
    subtitle: decision.subtitle || '',
    date: decision.date,
    body: decision.body,
    bodyLabel: decision.bodyLabel,
    voteRuleLabel: decision.voteRuleLabel || '',
    result: (decision.outcome && decision.outcome.result) || 'recorded',
    status: decision.status,
    file: `${DIR}/${name}`
  });
}

decisions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));

const index = {
  metadata: {
    project: 'EU Tracker',
    updated: new Date().toISOString().slice(0, 10),
    dataStatus: 'All bundled decisions are illustrative samples. See docs/DATA-MODEL.md.'
  },
  decisions
};

await writeFile(path.join(ROOT, DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`index.json — ${decisions.length} decisions, newest ${decisions[0].date}`);
