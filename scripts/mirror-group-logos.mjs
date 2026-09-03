#!/usr/bin/env node
/*
 * Mirror the political groups' own marks into the repository.
 *
 *   node scripts/mirror-group-logos.mjs --probe   # look, report, write nothing
 *   node scripts/mirror-group-logos.mjs           # take the ones still missing
 *   node scripts/mirror-group-logos.mjs --all     # take them all again
 *
 * Every group's mark is published by the Parliament on the page of any member
 * who sits in that group: a member's record carries the group's logo beside its
 * name. So the mark is found the way a reader finds it — open one member of the
 * group, look at their page — rather than by guessing at file names on a
 * server. Nothing here comes from anywhere but europarl.europa.eu.
 *
 * The same wall stands in front of that site as in front of the portraits: a
 * plain HTTP client gets an empty 202. So, as with the portraits, the page is
 * opened in a real Chromium and the bytes are fetched from inside it.
 *
 * © European Union. The groups' marks identify the groups themselves, which is
 * what the about page says they are doing here.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'assets/groups';
const MEP = 'https://www.europarl.europa.eu/meps/en/';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('This needs playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

/* The same slug the page builds, so a file lands where assets/js/groups.js
   looks for it: lowercased, anything that is not a letter or digit hyphened. */
function slug(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* The words that identify each group in an image's address or its alt text.
   A page names a group in several ways — its abbreviation, its acronym in
   another language, its full name — so each group brings its own list. */
const HINTS = {
  'EPP': ['epp', 'ppe', 'people'],
  'S&D': ['s-d', 's_d', 'sd', 'socialists', 'democrats'],
  'PfE': ['pfe', 'patriots'],
  'ECR': ['ecr', 'conservatives', 'reformists'],
  'Renew': ['renew', 'ren'],
  'Greens/EFA': ['greens', 'verts', 'efa', 'ale'],
  'The Left': ['left', 'gue', 'ngl'],
  'ESN': ['esn', 'sovereign'],
  'NI': ['ni', 'non-attached', 'non_attached', 'nonattached']
};

const directory = JSON.parse(await readFile(path.join(ROOT, 'data/reference/meps.json'), 'utf8'));
const members = directory.members || {};

/* One member per group — the first the directory names, which is arbitrary and
   fine: the mark on their page is the group's, not theirs. */
const example = new Map();
for (const [id, member] of Object.entries(members)) {
  if (member.group && !example.has(member.group)) example.set(member.group, id);
}

await mkdir(path.join(ROOT, OUT), { recursive: true });
const already = new Set(
  (await readdir(path.join(ROOT, OUT)))
    .filter((n) => /\.(svg|png|jpg|jpeg)$/i.test(n))
    .map((n) => n.replace(/\.[^.]+$/, ''))
);

const wanted = [...example.keys()].filter(
  (group) => has('--probe') || has('--all') || !already.has(slug(group))
);

console.log(`${wanted.length} group marks to look for (${already.size} already here).`);
if (!wanted.length) process.exit(0);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
const page = await context.newPage();

/* Every image on the page, with what the page says about it, so a mark can be
   recognised by more than its file name. Background images count: a mark is as
   often set in CSS as written as an <img>. */
/* A member's address redirects to their name — /meps/en/840 becomes
   /meps/en/840/ABIR_AL-SAHLANI/home — and a redirect lands mid-question if the
   question was asked too early. So it is asked again once the page has settled
   rather than treated as a failure. */
async function settled(work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!/Execution context was destroyed|Target closed|navigat/i.test(String(error.message))) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  return work();
}

async function pictures() {
  return settled(() => page.evaluate(() => {
    const found = [];
    document.querySelectorAll('img').forEach((image) => {
      if (!image.currentSrc && !image.src) return;
      found.push({
        url: image.currentSrc || image.src,
        alt: image.alt || '',
        title: image.title || '',
        near: (image.closest('[class]') || {}).className || '',
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0
      });
    });
    document.querySelectorAll('*').forEach((node) => {
      const picture = getComputedStyle(node).backgroundImage;
      const match = picture && picture.match(/url\(["']?(.+?)["']?\)/);
      if (!match || match[1].startsWith('data:')) return;
      found.push({
        url: new URL(match[1], location.href).href,
        alt: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 80),
        title: node.getAttribute('title') || '',
        near: node.className || '',
        width: 0, height: 0, background: true
      });
    });
    return found;
  }));
}

/* Fetched from inside the page, so it is the browser asking. */
async function bytes(url) {
  const answer = await settled(() => page.evaluate(async (address) => {
    try {
      const response = await fetch(address, { credentials: 'include' });
      if (!response.ok) return { status: response.status, body: null };
      const blob = await response.blob();
      if (!blob.size) return { status: response.status, body: null };
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
      return { status: response.status, type: blob.type, body: data };
    } catch (error) {
      return { status: 0, error: String(error && error.message), body: null };
    }
  }, url));
  return { ...answer, buffer: answer.body ? Buffer.from(answer.body, 'base64') : null };
}

/* Is this file actually a picture, and which kind? Read from the bytes, not
   from the name: a mark served without an extension is still a mark. */
function kind(buffer) {
  if (!buffer || buffer.length < 64) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  const head = buffer.subarray(0, 400).toString('utf8').toLowerCase();
  if (head.includes('<svg') || (head.includes('<?xml') && buffer.toString('utf8', 0, 2000).toLowerCase().includes('<svg'))) return 'svg';
  return null;
}

/* Which picture on a member's page is their group's mark. A page carries the
   member's own portrait, the Parliament's own emblem, flags, share icons; the
   score keeps what the page ties to this group by name and drops the rest. */
function score(picture, group) {
  const text = (picture.url + ' ' + picture.alt + ' ' + picture.title + ' ' + picture.near).toLowerCase();
  if (/mepphoto|\/flags?\//.test(picture.url.toLowerCase())) return 0;

  let points = 0;
  for (const hint of HINTS[group] || []) {
    // A word, not a fragment: "ni" must not match "united".
    if (new RegExp('(^|[^a-z])' + hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text)) {
      points += hint.length > 3 ? 3 : 2;
    }
  }
  if (!points) return 0;
  if (/logo|group|political/.test(text)) points += 3;
  if (/\.svg($|\?)/.test(picture.url.toLowerCase())) points += 2;
  return points;
}

let saved = 0;
const report = [];

for (const group of wanted) {
  const id = example.get(group);
  const address = MEP + id;
  try {
    await page.goto(address, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
  } catch (error) {
    console.warn(`${group}: could not open ${address} — ${error.message}`);
    continue;
  }

  const all = await pictures();
  const ranked = all
    .map((picture) => ({ picture, points: score(picture, group) }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points);

  if (has('--probe')) {
    console.log(`\n${group} — ${page.url()}`);
    console.log(`  ${all.length} pictures on the page; ${ranked.length} look like this group's mark`);
    all.slice(0, 40).forEach((picture) => {
      const mark = score(picture, group);
      console.log(`   ${mark ? '*' : ' '}${String(mark).padStart(2)} ${picture.url.slice(0, 120)}` +
        (picture.alt ? `  [${picture.alt.slice(0, 40)}]` : ''));
    });
  }

  let taken = false;
  for (const entry of ranked.slice(0, 5)) {
    const answer = await bytes(entry.picture.url);
    const type = kind(answer.buffer);
    if (!type) continue;
    const file = `${slug(group)}.${type}`;
    if (!has('--probe')) await writeFile(path.join(ROOT, OUT, file), answer.buffer);
    console.log(`  ${group} -> ${file} (${answer.buffer.length}b, ${entry.points} points) ${entry.picture.url}`);
    report.push({ group, file, from: entry.picture.url });
    saved += 1;
    taken = true;
    break;
  }
  if (!taken) console.warn(`  ${group}: nothing on the page looked like its mark.`);

  await page.waitForTimeout(300);
}

await browser.close();

if (!has('--probe') && report.length) {
  /* Where each file came from, in the repository, so the licence question has
     an answer that is not "somebody downloaded it once". */
  await writeFile(
    path.join(ROOT, OUT, 'sources.json'),
    JSON.stringify({
      note: 'Each group mark and the Parliament page it was taken from.',
      taken: new Date().toISOString().slice(0, 10),
      marks: report
    }, null, 2) + '\n'
  );
}

console.log(`\n${saved} of ${wanted.length} group marks ${has('--probe') ? 'found' : 'written'}.`);
process.exit(saved ? 0 : 1);
