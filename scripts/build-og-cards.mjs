#!/usr/bin/env node
/*
 * A link preview for every single vote.
 *
 *   node scripts/build-og-cards.mjs            # all of them
 *   node scripts/build-og-cards.mjs --only 195719,189599
 *   node scripts/build-og-cards.mjs --limit 5
 *
 * Writes assets/og/<voteId>.png at 1200x630 — the shape every social network
 * and messaging app crops a link preview from.
 *
 * Why this has to exist: Bluesky, X, LinkedIn, WhatsApp, Telegram, Slack and
 * every other unfurler fetches the shared address and renders the og:image it
 * finds. It never sees a URL fragment — browsers do not send one — so while a
 * vote lived at "#/195719" every vote on this site previewed as the same
 * generic card. The picture the story button makes never travelled either:
 * those buttons are ordinary links and a link carries no file. The only thing
 * that reaches a feed is what the address serves.
 *
 * These are built at publish time and never committed. One of them is around
 * 90 kilobytes; seven hundred of them would be sixty-odd megabytes of pictures
 * in a repository whose records are seventeen.
 *
 * The map is projected once and only its fills change per vote, which is what
 * makes seven hundred cards a matter of seconds rather than minutes.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/og');
const SCRATCH = path.join(ROOT, '.og-cards.html');

const argv = process.argv.slice(2);
const only = (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '')
  .split(',').map(s => s.trim()).filter(Boolean);
const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('needs playwright: npm i --no-save playwright'); process.exit(1); }

const index = JSON.parse(readFileSync(path.join(ROOT, 'data/decisions/index.json'), 'utf8'));
const geo = readFileSync(path.join(ROOT, 'data/eu-countries.geo.json'), 'utf8');
const projection = readFileSync(path.join(ROOT, 'assets/js/projection.js'), 'utf8');
const states = JSON.parse(readFileSync(path.join(ROOT, 'data/reference/member-states.json'), 'utf8')).states;
const SEATS = states.reduce((sum, s) => sum + s.seats, 0);
const byCode = Object.fromEntries(states.map(s => [s.code, s]));

/* A ballot stores [memberId, position], and position is an index into this —
   the same array assets/js/data.js reads. Getting it wrong would paint the
   whole continent the wrong colour without erroring once. */
const VOTE_KEYS = ['for', 'against', 'abstain', 'absent'];

const MEPS = JSON.parse(readFileSync(path.join(ROOT, 'data/reference/meps.json'), 'utf8'));
const HOME = {};
for (const [id, member] of Object.entries(MEPS.members || MEPS)) {
  if (member && member.country) HOME[String(id)] = member.country;
}

/* Exactly the rule the page uses (Data.delegationPosition): a country shows
   where most of its members went, ranked for / against / abstain, and a
   country with nothing cast is absent. Deliberately the same sort, ties
   included — a preview that disagreed with the page it links to would be
   worse than no preview. */
function countryPositions(record) {
  const tally = {};
  for (const ballot of record.ballots || []) {
    const code = HOME[String(ballot[0])];
    const key = VOTE_KEYS[ballot[1]];
    if (!code || !key || key === 'absent') continue;
    (tally[code] || (tally[code] = { for: 0, against: 0, abstain: 0 }))[key] += 1;
  }
  const out = {};
  for (const code of Object.keys(byCode)) {
    const t = tally[code];
    if (!t) { out[code] = 'absent'; continue; }
    if (!(t.for + t.against + t.abstain)) { out[code] = 'absent'; continue; }
    out[code] = ['for', 'against', 'abstain'].sort((a, b) => t[b] - t[a])[0];
  }
  return out;
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #0b1b3a; color: #fff; overflow: hidden;
         font-family: 'IBM Plex Sans', system-ui, sans-serif;
         display: grid; grid-template-columns: 1fr 430px; }
  #edge { position: absolute; inset: 0 0 auto 0; height: 9px; background: #c3d0e8; }
  /* Centred as a block, so a two-word title and a four-line one both sit
     balanced rather than one of them leaving a hole in the middle. */
  .words { padding: 50px 0 46px 64px; display: flex; flex-direction: column;
           justify-content: center; height: 630px; }
  /* The masthead is pinned to the top; the vote itself is centred below it. */
  .head { position: absolute; top: 50px; left: 64px; }
  .mark { display: flex; align-items: center; gap: 12px; }
  .dot { width: 26px; height: 26px; border-radius: 50%; background: #0b3a8f; border: 3px dashed #ffd617; }
  .name { font-weight: 700; font-size: 22px; letter-spacing: .02em; }
  .meta { margin-top: 16px; font-size: 17px; font-weight: 600; letter-spacing: .07em;
          text-transform: uppercase; color: #8fa6cc; }
  h1 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 700; letter-spacing: -.015em;
       line-height: 1.08; overflow: hidden; }
  .verdict { font-size: 60px; font-weight: 700; line-height: 1; margin-top: 30px; }
  .bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin-top: 20px;
         width: 100%; background: #16274b; }
  .bar span { display: block; }
  .counts { margin-top: 18px; font-size: 25px; font-weight: 700; display: flex;
            gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .counts i { font-style: normal; font-size: 18px; font-weight: 600; color: #c3d0e8; }
  .counts em { font-style: normal; color: #5b6b86; font-weight: 400; }
  .seats { margin-top: 10px; font-size: 17px; color: #8fa6cc; }
  .map { display: flex; align-items: center; justify-content: center; height: 630px; }
  svg { width: 400px; height: 470px; }
  path { stroke: #0b1b3a; stroke-width: .9; }
</style></head><body>
  <div id="edge"></div>
  <div class="words">
    <div class="head">
      <div class="mark"><span class="dot"></span><span class="name">EU TRACKER</span></div>
      <div class="meta" id="meta"></div>
    </div>
    <h1 id="title"></h1>
    <div class="verdict" id="verdict"></div>
    <div class="bar" id="bar"></div>
    <div class="counts" id="counts"></div>
    <div class="seats" id="seats"></div>
  </div>
  <div class="map" id="map"></div>
<script>${projection}</script>
<script>
  const VOTE = { for: '#2f9c7d', against: '#d75b4c', abstain: '#d8a53a',
                 split: '#7c8ba1', absent: '#3a4351', unknown: '#3a4351' };
  const RESULT = { adopted: ['Adopted', '#38c08a'], rejected: ['Rejected', '#ff7a6b'],
                   recorded: ['Recorded', '#c3d0e8'] };
  const geo = ${geo};

  /* Framed on the member states alone, and the neighbours are not drawn: on a
     card there is nothing to pan around, so a neighbour cut off mid-country
     reads as a slab laid over the picture rather than as land. */
  const framed = { type: geo.type, features: geo.features.map(function (f) {
    if (!f.properties || f.properties.frame !== true) return f;
    const p = {}; Object.keys(f.properties).forEach(function (k) {
      if (k !== 'frame') p[k] = f.properties[k]; });
    return { type: f.type, id: f.id, properties: p, geometry: f.geometry };
  }) };
  const layout = window.Projection.layout(framed, 400, 470, 6);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 400 470');
  const paths = {};
  layout.shapes.forEach(function (shape) {
    if (!shape.member) return;
    const node = document.createElementNS(ns, 'path');
    node.setAttribute('d', shape.path);
    svg.appendChild(node);
    (paths[shape.code] || (paths[shape.code] = [])).push(node);
  });
  document.getElementById('map').appendChild(svg);

  // Only the fills and the words change per vote; the geometry is done.
  window.paint = function (vote) {
    document.getElementById('edge').style.background = (RESULT[vote.result] || RESULT.recorded)[1];
    document.getElementById('meta').textContent = 'European Parliament · ' + vote.dateLabel;

    const title = document.getElementById('title');
    title.textContent = vote.title;
    // The title takes what room is left, at the largest size that fits it.
    for (const size of [50, 44, 39, 34, 30, 26]) {
      title.style.fontSize = size + 'px';
      title.style.maxHeight = (size * 1.08 * 4) + 'px';
      if (title.scrollHeight <= size * 1.08 * 4 + 2) break;
    }

    const r = RESULT[vote.result] || RESULT.recorded;
    const verdict = document.getElementById('verdict');
    verdict.textContent = r[0];
    verdict.style.color = r[1];

    const cast = vote.totals.for + vote.totals.against + vote.totals.abstain;
    document.getElementById('bar').innerHTML = ['for', 'against', 'abstain'].map(function (k) {
      const pct = cast ? (vote.totals[k] / cast) * 100 : 0;
      return pct > 0 ? '<span style="width:' + pct.toFixed(2) + '%;background:' +
        ({ for: '#1a7f5a', against: '#b3372c', abstain: '#b8860b' })[k] + '"></span>' : '';
    }).join('');

    document.getElementById('counts').innerHTML =
      '<span style="color:#38c08a">' + vote.totals.for + '</span><i>for</i><em>·</em>' +
      '<span style="color:#ff7a6b">' + vote.totals.against + '</span><i>against</i><em>·</em>' +
      '<span style="color:#e8b93f">' + vote.totals.abstain + '</span><i>abstained</i>';
    document.getElementById('seats').textContent =
      cast + ' of ' + vote.seats + ' members voted · ' + (vote.seats - cast) + ' did not';

    Object.keys(paths).forEach(function (code) {
      const fill = VOTE[vote.positions[code]] || VOTE.unknown;
      paths[code].forEach(function (n) { n.setAttribute('fill', fill); });
    });
  };
</script></body></html>`;

writeFileSync(SCRATCH, html, 'utf8');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('file://' + SCRATCH, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

let wanted = index.decisions;
if (only.length) wanted = wanted.filter(d => only.includes(String(d.sourceId)));
if (limit) wanted = wanted.slice(0, limit);

const MONTHS = ['January','February','March','April','May','June','July','August',
  'September','October','November','December'];
const spoken = d => { const p = d.split('-'); return Number(p[2]) + ' ' + MONTHS[+p[1]-1] + ' ' + p[0]; };

const started = Date.now();
let bytes = 0;
for (let i = 0; i < wanted.length; i++) {
  const entry = wanted[i];
  const record = JSON.parse(readFileSync(path.join(ROOT, 'data/decisions', entry.id + '.json'), 'utf8'));
  const totals = { for: 0, against: 0, abstain: 0 };
  for (const ballot of record.ballots || []) {
    const key = VOTE_KEYS[ballot[1]];
    if (key && key in totals) totals[key] += 1;
  }
  await page.evaluate(v => window.paint(v), {
    title: record.title,
    dateLabel: spoken(record.date),
    result: (record.outcome && record.outcome.result) || 'recorded',
    totals, seats: SEATS,
    positions: countryPositions(record)
  });
  const file = path.join(OUT, entry.sourceId + '.png');
  const shot = await page.screenshot({ path: file });
  bytes += shot.length;
  if ((i + 1) % 100 === 0 || i === wanted.length - 1) {
    console.log('  ' + (i + 1) + '/' + wanted.length + '  ' +
      Math.round((Date.now() - started) / 1000) + 's  ' +
      (bytes / 1024 / 1024).toFixed(1) + ' MB so far');
  }
}
await browser.close();
rmSync(SCRATCH, { force: true });
console.log('assets/og — ' + wanted.length + ' cards, ' + (bytes / 1024 / 1024).toFixed(1) +
  ' MB, mean ' + Math.round(bytes / wanted.length / 1024) + ' KB, ' +
  Math.round((Date.now() - started) / 1000) + 's');
