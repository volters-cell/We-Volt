#!/usr/bin/env node
/*
 * Can a vote be labelled with its subject, from the Parliament's own data?
 *
 * HowTheyVote puts a chip on every entry — Venezuela, Economy and budget,
 * United Kingdom, Gender equality — and this site has nothing like it. The
 * Parliament does publish the subjects: a document carries is_about, a list of
 * EuroVoc concept URIs such as http://eurovoc.europa.eu/121. What it has not
 * yet given up is a name for one. Four addresses were guessed at and all four
 * were empty, which says nothing except that four guesses were wrong.
 *
 * So this stops guessing and reads the API's own index. Whatever collections
 * data.europarl.europa.eu publishes, it should be willing to list them, and
 * one of them either names a concept or none does. If none does, the fallback
 * is the committee that wrote the report — EP_ENVI, EP_AFCO, INTA — which is
 * also a subject, in the Parliament's own words, and is already on the
 * document.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
const BASE = 'https://data.europarl.europa.eu/api/v2';
const AGENT = 'EU-Tracker/1.0 (+https://github.com/volters-cell/We-Volt) probe';

async function look(url, accept) {
  try {
    const response = await fetch(url, {
      headers: { accept: accept || 'application/ld+json', 'user-agent': AGENT },
      redirect: 'follow'
    });
    const body = await response.text();
    return { status: response.status, type: response.headers.get('content-type') || '', body: body };
  } catch (error) {
    return { status: 0, type: '', body: String(error.message) };
  }
}

console.log('what does the API say it publishes?');
for (const url of [
  `${BASE}/`,
  `${BASE}/openapi.json`,
  `${BASE}/swagger.json`,
  'https://data.europarl.europa.eu/api/v2/api-docs',
  'https://data.europarl.europa.eu/en/developer-corner/opendata-api'
]) {
  const answer = await look(url, 'application/json');
  console.log(`\n  ${url}`);
  console.log(`    ${answer.status}  ${answer.type}  ${answer.body.length} bytes`);
  if (answer.status !== 200) continue;

  // Names of paths, whatever shape the document takes.
  const paths = answer.body.match(/"\/[a-z0-9\-_\/{}]+"/gi);
  if (paths) {
    const unique = [...new Set(paths.map((p) => p.replace(/"/g, '')))]
      .filter((p) => p.length > 2 && !p.includes('{'));
    console.log(`    paths: ${unique.slice(0, 60).join(' ')}`);
    const subjecty = unique.filter((p) => /eurovoc|concept|subject|topic|theme|vocab|taxonom/i.test(p));
    if (subjecty.length) console.log(`    ** subject-like: ${subjecty.join(' ')}`);
  } else {
    const links = answer.body.match(/href="[^"]*api\/v2[^"]*"/g);
    if (links) console.log(`    links: ${[...new Set(links)].slice(0, 25).join(' ')}`);
  }
}

/* And whether the concept URI answers for itself, at the Parliament. */
console.log('\n\ndoes the portal proxy a concept?');
for (const path of ['/eurovoc-concepts/121', '/eurovoc_concepts/121', '/concepts/121',
  '/subject-matters/121', '/thesaurus/121', '/eurovoc-domains/121']) {
  const answer = await look(`${BASE}${path}?format=application%2Fld%2Bjson`);
  console.log(`  ${path.padEnd(24)} ${answer.status}  ${answer.body.slice(0, 90).replace(/\s+/g, ' ')}`);
}
