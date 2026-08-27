#!/usr/bin/env node
/*
 * Draw the card that appears when the site is shared.
 *
 *   npx playwright@1.49 install chromium     # once, if you have no browser
 *   node scripts/build-social-card.mjs
 *
 * Writes assets/social-card.png at 1200x630, the size every social network and
 * messaging app crops from. It draws the project's own map, from the project's
 * own outline file, so the preview is the thing itself rather than a picture of
 * it — and it carries only figures that do not move: the seats in the chamber,
 * the member states, and when the term began. A vote count would be wrong by
 * the next sitting.
 *
 * Rebuild it when the map, the branding or the tagline changes. Nothing else
 * needs it, which is why playwright is not a dependency of this project.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets/social-card.png');
const SCRATCH = path.join(ROOT, '.social-card.html');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('This needs playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const geo = readFileSync(path.join(ROOT, 'data/eu-countries.geo.json'), 'utf8');
const projection = readFileSync(path.join(ROOT, 'assets/js/projection.js'), 'utf8');
const states = JSON.parse(readFileSync(path.join(ROOT, 'data/reference/member-states.json'), 'utf8')).states;
const seats = states.reduce(function (sum, state) { return sum + state.seats; }, 0);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #0b1b3a; color: #fff;
         font-family: 'IBM Plex Sans', system-ui, sans-serif; overflow: hidden;
         display: grid; grid-template-columns: 1fr 520px; align-items: center; }
  .words { padding: 72px 0 72px 76px; }
  .mark { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
  .dot { width: 30px; height: 30px; border-radius: 50%; background: #0b3a8f;
         border: 3px dashed #ffd617; }
  .name { font-weight: 700; font-size: 25px; letter-spacing: .02em; }
  h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: 62px; line-height: 1.06;
       font-weight: 700; letter-spacing: -.02em; }
  p { margin-top: 22px; font-size: 25px; line-height: 1.35; color: #c3d0e8; max-width: 20ch; }
  .facts { margin-top: 34px; display: flex; gap: 30px; font-size: 19px; color: #8fa6cc; }
  .facts b { display: block; font-size: 30px; color: #ffd617; font-weight: 700; }
  .map { height: 630px; display: flex; align-items: center; justify-content: center; }
  svg { width: 520px; height: 600px; }
  .member { fill: #2f6fd0; stroke: #0b1b3a; stroke-width: .8; }
  .context { fill: #1b2c50; stroke: #0b1b3a; stroke-width: .6; }
</style></head><body>
  <div class="words">
    <div class="mark"><span class="dot"></span><span class="name">EU TRACKER</span></div>
    <h1>Every vote of the European Parliament</h1>
    <p>Member by member, country by country.</p>
    <div class="facts">
      <span><b>${seats}</b>members</span>
      <span><b>${states.length}</b>member states</span>
      <span><b>2024</b>since July</span>
    </div>
  </div>
  <div class="map" id="map"></div>
<script>${projection}</script>
<script>
  const geo = ${geo};
  const layout = window.Projection.layout(geo, 520, 600, 10);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 520 600');
  const behind = document.createElementNS(ns, 'g');
  const front = document.createElementNS(ns, 'g');
  layout.shapes.forEach(function (shape) {
    const node = document.createElementNS(ns, 'path');
    node.setAttribute('d', shape.path);
    node.setAttribute('class', shape.member ? 'member' : 'context');
    (shape.member ? front : behind).appendChild(node);
  });
  svg.appendChild(behind);
  svg.appendChild(front);
  document.getElementById('map').appendChild(svg);
</script></body></html>`;

writeFileSync(SCRATCH, html, 'utf8');
// CHROME_PATH lets a machine with a browser already on it skip the download.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('file://' + SCRATCH, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT });
await browser.close();
unlinkSync(SCRATCH);
console.log(`assets/social-card.png — ${seats} seats, ${states.length} member states`);
