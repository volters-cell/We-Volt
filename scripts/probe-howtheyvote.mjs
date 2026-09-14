#!/usr/bin/env node
/*
 * How many votes does HowTheyVote hold, and which ones?
 *
 *   node scripts/probe-howtheyvote.mjs
 *
 * This project's own filter keeps 40% of the ninth term's roll-calls and 12%
 * of the tenth's — the same rule, wildly different results, so at least one is
 * wrong. HowTheyVote.eu holds 2,421, and which term that covers decides which
 * of ours is the broken one: 2,421 is 13% of the ninth term's roll-calls and
 * 41% of the tenth's.
 *
 * Rather than guess at their method, this looks for their published data.
 * They are an open-data project; the addresses below are candidates, not
 * knowledge, and the run reports which of them answer.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */

const CANDIDATES = [
  ['API, votes',            'https://howtheyvote.eu/api/votes?limit=1'],
  ['API on its own host',   'https://api.howtheyvote.eu/api/votes?limit=1'],
  ['the site itself',       'https://howtheyvote.eu/'],
  ['data releases',         'https://api.github.com/repos/HowTheyVote/data/releases?per_page=3'],
  ['the data repository',   'https://api.github.com/repos/HowTheyVote/data'],
  ['the code repository',   'https://api.github.com/repos/HowTheyVote/howtheyvote'],
  ['their documentation',   'https://howtheyvote.eu/about']
];

const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';

for (const [name, url] of CANDIDATES) {
  console.log('\n' + '='.repeat(72));
  console.log(name);
  console.log(url);
  console.log('='.repeat(72));
  try {
    const response = await fetch(url, { headers: { accept: '*/*', 'user-agent': AGENT }, redirect: 'follow' });
    const type = response.headers.get('content-type') || '';
    console.log(`  ${response.status} ${response.statusText}  ${type}`);
    if (!response.ok) continue;

    const body = await response.text();
    console.log(`  ${body.length} bytes`);
    if (/json/.test(type)) {
      try {
        const data = JSON.parse(body);
        console.log('  keys: ' + Object.keys(Array.isArray(data) ? (data[0] || {}) : data).join(', '));
        console.log('  ' + JSON.stringify(data, null, 1).slice(0, 1400).split('\n').join('\n  '));
      } catch (error) {
        console.log('  (not parseable as JSON)');
      }
    } else {
      /* A page, not data: print the lines that carry a count or point at one. */
      const text = body.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      ['votes', 'download', 'dataset', 'API', 'CSV', 'Zenodo', 'licen'].forEach(function (word) {
        const at = text.toLowerCase().indexOf(word.toLowerCase());
        if (at === -1) return;
        console.log(`  · ${word}: …${text.slice(Math.max(0, at - 120), at + 180).trim()}…`);
      });
    }
  } catch (error) {
    console.log('  FAILED ' + String(error.message).slice(0, 110));
  }
}
