#!/usr/bin/env node
/*
 * A real page for every vote, so a shared vote looks like that vote.
 *
 *   node scripts/build-vote-pages.mjs
 *
 * Writes v/<voteId>/index.html for all 718, plus a sitemap listing them.
 *
 * Why a page and not a fragment: every unfurler — Bluesky, X, LinkedIn,
 * WhatsApp, Telegram, Slack, iMessage — fetches the shared address and reads
 * the og:image and og:title it is served. A browser never sends the part of a
 * URL after "#", so a server cannot know which vote "#/195719" means, and
 * every vote on this site previewed as the same generic card. A real path can
 * be served a real answer.
 *
 * Each page carries that vote's own preview picture and a plain summary of it,
 * then hands the reader to the app. The summary is not decoration: a crawler
 * does not run scripts, and neither does a reader whose scripts have failed,
 * and both should still be told how the vote went and where to check it.
 *
 * Built at publish time and not committed — they are derived from the records,
 * and a copy of derived data in a repository is a copy that goes stale.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'v');

/* The site's own address, taken from the page rather than typed again here. */
const SITE = (readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .match(/<meta property="og:url" content="([^"]+)"/) || [])[1] ||
  'https://volters-cell.github.io/We-Volt/';
const BASE = SITE.replace(/\/?$/, '/');

const index = JSON.parse(readFileSync(path.join(ROOT, 'data/decisions/index.json'), 'utf8'));
const VOTE_KEYS = ['for', 'against', 'abstain', 'absent'];
const states = JSON.parse(readFileSync(path.join(ROOT, 'data/reference/member-states.json'), 'utf8')).states;
const SEATS = states.reduce((sum, s) => sum + s.seats, 0);

const MONTHS = ['January','February','March','April','May','June','July','August',
  'September','October','November','December'];
const spoken = d => { const p = d.split('-'); return Number(p[2]) + ' ' + MONTHS[+p[1]-1] + ' ' + p[0]; };
const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const RESULT = { adopted: 'Adopted', rejected: 'Rejected' };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const listed = [];
for (const entry of index.decisions) {
  const record = JSON.parse(readFileSync(path.join(ROOT, 'data/decisions', entry.id + '.json'), 'utf8'));
  const totals = { for: 0, against: 0, abstain: 0 };
  for (const ballot of record.ballots || []) {
    const key = VOTE_KEYS[ballot[1]];
    if (key && key in totals) totals[key] += 1;
  }
  const cast = totals.for + totals.against + totals.abstain;
  const result = (record.outcome && record.outcome.result) || 'recorded';
  const word = RESULT[result] || 'Recorded';
  const id = record.sourceId;
  const day = spoken(record.date);

  const summary = word + ' by the European Parliament on ' + day + ' — ' +
    totals.for + ' in favour, ' + totals.against + ' against, ' + totals.abstain +
    ' abstained. ' + cast + ' of ' + SEATS + ' members voted. See how every country ' +
    'and every MEP split.';

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(record.title)} — ${esc(word)} — EU Tracker</title>
<meta name="description" content="${esc(summary)}">
<link rel="canonical" href="${BASE}v/${id}/">

<meta property="og:type" content="article">
<meta property="og:site_name" content="EU Tracker">
<meta property="og:url" content="${BASE}v/${id}/">
<meta property="og:title" content="${esc(record.title)} — ${esc(word)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:image" content="${BASE}assets/og/${id}.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(record.title)}: ${esc(word)}, ${totals.for} in favour, ${totals.against} against, ${totals.abstain} abstained, with the European Union painted by the vote.">
<meta property="og:locale" content="en_GB">
<meta property="article:published_time" content="${record.date}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(record.title)} — ${esc(word)}">
<meta name="twitter:description" content="${esc(summary)}">
<meta name="twitter:image" content="${BASE}assets/og/${id}.png">
<meta name="theme-color" content="#0b3a8f">

<link rel="stylesheet" href="../../assets/css/style.css">
<style>
  .vote-shell { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem; }
  .vote-shell .vote-day { font-size: .8rem; font-weight: 700; letter-spacing: .1em;
    text-transform: uppercase; color: var(--ink-faint); margin: 0 0 .5rem; }
  .vote-shell h1 { font-size: clamp(1.6rem, 4.5vw, 2.3rem); line-height: 1.15; margin: 0 0 .8rem; }
  .vote-shell .vote-word { font-size: 1.6rem; font-weight: 700; margin: 0 0 .6rem; }
  .vote-shell .vote-word.adopted { color: var(--ink-for); }
  .vote-shell .vote-word.rejected { color: var(--ink-against); }
  .vote-shell .vote-numbers { font-size: 1.05rem; margin: 0 0 1.4rem; color: var(--ink-soft); }
  .vote-shell .vote-open { display: inline-block; font-weight: 600; padding: .7rem 1.2rem;
    border-radius: 10px; background: var(--eu-blue); color: #fff; text-decoration: none; }
  .vote-shell img { width: 100%; height: auto; border-radius: 12px; margin: 0 0 1.6rem;
    border: 1px solid var(--line); }
</style>
</head>
<body>
<!-- A reader with scripts goes straight into the tracker; this page is what a
     crawler, a preview card and a reader without scripts get to see. -->
<script>
  /* A country travels on the end as a hash — v/195719/#DE — because the
     preview belongs to the vote and the panel belongs to the reader. */
  var where = location.hash ? '/' + location.hash.slice(1) : '';
  location.replace('../../#/${id}' + where);
</script>
<main class="vote-shell">
  <img src="../../assets/og/${id}.png" width="1200" height="630"
       alt="${esc(record.title)}: ${esc(word)}, ${totals.for} in favour, ${totals.against} against, ${totals.abstain} abstained.">
  <p class="vote-day">European Parliament · ${esc(day)}</p>
  <h1>${esc(record.title)}</h1>
  <p class="vote-word ${esc(result)}">${esc(word)}</p>
  <p class="vote-numbers">${totals.for} in favour · ${totals.against} against ·
     ${totals.abstain} abstained. ${cast} of ${SEATS} members voted; ${SEATS - cast} did not.</p>
  <p><a class="vote-open" href="../../#/${id}">See how every country and every MEP voted</a></p>
  <h2>Check it at the European Parliament</h2>
  <ul>
${(record.sources || []).filter(s => s.url).map(s =>
  `    <li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.label)}</a></li>`).join('\n')}
  </ul>
</main>
</body>
</html>
`;
  mkdirSync(path.join(OUT, String(id)), { recursive: true });
  writeFileSync(path.join(OUT, String(id), 'index.html'), page);
  listed.push({ id, date: record.date });
}

/* The sitemap can finally list the votes, because they are finally pages. */
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Written by scripts/build-vote-pages.mjs at publish time. Every vote is a
     real page now, so every vote can be listed: a crawler used to read
     "#/195719" as the same document as every other vote. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${BASE}about.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>
${listed.map(v =>
  `  <url><loc>${BASE}v/${v.id}/</loc><lastmod>${v.date}</lastmod><priority>0.7</priority></url>`).join('\n')}
</urlset>
`;
writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);

console.log('v/ — ' + listed.length + ' vote pages, sitemap listing ' + (listed.length + 2) + ' urls');
