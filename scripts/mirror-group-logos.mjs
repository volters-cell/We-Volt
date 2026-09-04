#!/usr/bin/env node
/*
 * Mirror the political groups' own marks into the repository.
 *
 *   node scripts/mirror-group-logos.mjs --probe    # look, report, write nothing
 *   node scripts/mirror-group-logos.mjs            # take the ones still missing
 *   node scripts/mirror-group-logos.mjs --all      # take them all again
 *   node scripts/mirror-group-logos.mjs --survey   # list every picture on given pages
 *
 * Where these come from, and why not from the Parliament.
 *
 * The Parliament publishes a portrait of every member, and those are mirrored
 * here from europarl.europa.eu (see mirror-faces.mjs). It does not publish the
 * political groups' logos. Ten of its pages were surveyed — every member page,
 * the members' directory and its advanced search, the page on the political
 * groups, the plenary's own page on them, the topic page, and the election
 * results site — and between them they carry portraits, the Parliament's own
 * emblem, and interface icons. No group marks, in any format.
 *
 * So each mark is taken from the one place that certainly publishes it: that
 * group's own website, in its own header. A group's mark used to identify that
 * group — which is exactly what a row labelled "Renew Europe" does — is the
 * ordinary, nominative use of a trademark, and every file records the page it
 * came from in sources.json so the question always has an answer.
 *
 * Nothing is guessed at: the script opens the group's home page, looks at what
 * the header actually carries, and takes the picture the site itself uses as
 * its mark — an <img>, a CSS background, or an inline <svg> serialised as one.
 * --probe prints what it found and its reasoning without writing anything.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'assets/groups';

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

/* Each group's own site. The non-attached members are not a group and have no
   mark; they keep their tile. */
const SITES = {
  'EPP': 'https://www.eppgroup.eu/',
  'S&D': 'https://www.socialistsanddemocrats.eu/en',
  'Renew': 'https://www.reneweuropegroup.eu/',
  'Greens/EFA': 'https://www.greens-efa.eu/en/',
  'ECR': 'https://ecrgroup.eu/',
  'PfE': 'https://patriotsforeurope.eu/',
  'The Left': 'https://left.eu/the-group/',
  'ESN': 'https://esn-group.eu/'
};

/* One site defeats the heuristic: the EPP's home page carries no mark as an
   image and no drawn one in its header — 47 pictures, and the ten that score
   are all article photographs. Its mark is served as a stylesheet background
   from its own theme, so that file is named here rather than guessed at. An
   entry only ever names a file on the group's own site. */
/* A mark this cannot find by looking, named because the site's own code names
   it. The EPP's header holds an empty <div name="logo-eppfull">, and the
   sprite map inside its own script says where that name lives:
   {"logo-eppmin":{"path":"/themes/.../icons/logo-eppmin.svg", ...}}. So these
   are the group's own files at the group's own addresses, read out of the
   group's own code — not guesses. Tried in order; the first real picture wins. */
const MARK = {
  'EPP': [
    'https://www.eppgroup.eu/themes/customs/eppgroup/images/eppgroup2023/icons/logo-eppfull.svg',
    'https://www.eppgroup.eu/themes/customs/eppgroup/images/eppgroup2023/icons/logo-eppmin.svg'
  ]
};

/* Groups whose mark this cannot reach, and must therefore not guess at.
 *
 * The EPP. Its header holds an empty <div name="logo-eppfull" alt="EPP Group
 * logo"> and fills it in from its own script bundle, so the mark is in none of
 * the places a page can be asked about it: not an image, not a background, not
 * a mask, not a pseudo-element, not content:url(), not an inline drawing, and
 * not in the traffic — of the fourteen pictures the page fetches, the three
 * that are not photographs are two background textures and a translucent
 * watermark heart with no lettering, which was taken once, rendered, and
 * rejected.
 *
 * Left to itself the scoring would then settle on the best of what remains,
 * which is an article photograph. So it is stopped here: the EPP keeps its
 * lettered tile, which says the right thing, rather than wearing a stock
 * picture. */
const CANNOT = {};

await mkdir(path.join(ROOT, OUT), { recursive: true });

/* ------------------------------------------------------------------ survey */

if (has('--survey')) {
  const pages = (process.env.SURVEY_PAGES || Object.values(SITES).join(','))
    .split(',').map((one) => one.trim()).filter(Boolean);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 }, locale: 'en-GB' });
  const page = await context.newPage();


  for (const address of pages) {
    try {
      await page.goto(address, { waitUntil: 'load', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } catch (error) {
      console.log(`\n${address}\n  could not open: ${error.message}`);
      continue;
    }
    const seen = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('img').forEach((image) => {
        const url = image.currentSrc || image.src;
        if (url) out.push({ how: 'img', url, text: image.alt || image.title || '' });
      });
      document.querySelectorAll('*').forEach((node) => {
        const picture = getComputedStyle(node).backgroundImage;
        const match = picture && picture.match(/url\(["']?(.+?)["']?\)/);
        if (match && !match[1].startsWith('data:')) {
          out.push({ how: 'css', url: new URL(match[1], location.href).href, text: '' });
        }
      });
      document.querySelectorAll('svg').forEach((node, index) => {
        out.push({ how: 'svg', url: `inline svg #${index} ${node.getAttribute('class') || ''}`,
                   text: (node.getAttribute('aria-label') || '').slice(0, 60) });
      });
      return out;
    });
    const already = new Set();
    console.log(`\n${page.url()}`);
    seen.filter((item) => {
      const key = item.how + item.url;
      if (already.has(key)) return false;
      already.add(key);
      return true;
    }).slice(0, 60).forEach((item) => {
      console.log(`   ${item.how.padEnd(4)} ${item.url.slice(0, 130)}` + (item.text ? `  [${item.text}]` : ''));
    });
  }

  await browser.close();
  process.exit(0);
}

/* --------------------------------------------------------------------- dig

   For a site that fills its mark in from a script. The EPP's header holds an
   empty <div name="logo-eppfull">, so the drawing is in the code the page
   loads rather than in the page. This waits properly for the hydration, then,
   if the div is still empty, reads the page's own scripts and stylesheets
   looking for the name — and prints what it finds around it. */
if (has('--dig')) {
  const group = (process.env.ONLY_GROUPS || 'EPP').split(',')[0].trim();
  const site = SITES[group];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  const page = await context.newPage();

  await page.goto(site, { waitUntil: 'load', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  // Long enough for anything that hydrates after the page settles.
  await page.waitForTimeout(9000);

  console.log(`${group} — ${page.url()}`);
  console.log('the brand element, after waiting:');
  console.log(await page.evaluate(() => {
    const node = document.querySelector('.navbar-brand [class*="logo"], [name*="logo"], .img-logo');
    if (!node) return '(not found)';
    return node.outerHTML.replace(/\s+/g, ' ').slice(0, 1200);
  }));

  const sources = await page.evaluate(() =>
    [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
      .map((node) => node.src || node.href).filter(Boolean));
  console.log(`\n${sources.length} scripts and stylesheets to read.`);

  for (const address of sources) {
    let text = '';
    try {
      const answer = await context.request.get(address, { timeout: 30000 });
      if (!answer.ok()) continue;
      text = await answer.text();
    } catch (error) {
      continue;
    }
    // The name the header gives the mark, and any drawing near it.
    const at = text.search(/logo-?epp|eppfull|logo-full/i);
    if (at < 0) continue;
    console.log(`\n--- ${address.slice(0, 130)} (${text.length} bytes), match at ${at}`);
    console.log(text.slice(Math.max(0, at - 700), at + 1400).replace(/\s+/g, ' '));
  }

  await browser.close();
  process.exit(0);
}

/* -------------------------------------------------------------------- take */

const already = new Set(
  (await readdir(path.join(ROOT, OUT)))
    .filter((name) => /\.(svg|png|jpe?g)$/i.test(name))
    .map((name) => name.replace(/\.[^.]+$/, ''))
);

const only = (process.env.ONLY_GROUPS || '').split(',').map((one) => one.trim()).filter(Boolean);
const wanted = Object.keys(SITES).filter(
  (group) => (!only.length || only.includes(group)) && !CANNOT[group] &&
    (has('--probe') || has('--all') || !already.has(slug(group)))
);

Object.keys(CANNOT).forEach((group) => {
  console.log(`${group}: skipped — ${CANNOT[group]}. It keeps its lettered tile.`);
});

console.log(`${wanted.length} group marks to take (${already.size} already here).`);
if (!wanted.length) process.exit(0);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
const page = await context.newPage();

/* Every picture the page actually asks the network for. Some sites hydrate a
   mark from a script — the EPP's header holds an empty div named
   "logo-eppfull" and fills it in later — so the file exists in the traffic
   even when it is in neither the markup nor any computed style. */
const requested = new Map();
page.on('response', (response) => {
  const type = String(response.headers()['content-type'] || '');
  if (!/^image\//.test(type)) return;
  const url = response.url();
  if (!requested.has(url)) requested.set(url, type);
});

/* A page can redirect on arrival — to a language, or to a consent screen — and
   a question asked mid-redirect lands nowhere. So it is asked again. */
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

/* What a site uses as its own mark: the picture in the top-left of the header,
   inside the link that goes home. That is where a site puts its logo, and it is
   a stronger signal than any word in a file name. Everything found is scored,
   so --probe can show the reasoning and not just the answer. */
async function candidates() {
  return settled(() => page.evaluate(() => {
    const found = [];

    function place(node) {
      const box = node.getBoundingClientRect();
      const home = node.closest('a');
      const href = home ? home.getAttribute('href') || '' : '';
      const goesHome = /^(\/|\.?\/?(index|home)?)$/.test(href.trim()) ||
        (home && home.href && (home.href === location.origin + '/' || home.href === location.href));
      return {
        top: Math.round(box.top), left: Math.round(box.left),
        width: Math.round(box.width), height: Math.round(box.height),
        inHeader: !!node.closest('header, [role="banner"], .header, #header, .site-header, nav'),
        goesHome: !!goesHome
      };
    }

    document.querySelectorAll('img').forEach((image) => {
      const url = image.currentSrc || image.src;
      if (!url || url.startsWith('data:')) return;
      found.push({ kind: 'img', url, alt: image.alt || '',
                   words: [image.alt, image.title, image.className, image.id].join(' '),
                   ...place(image) });
    });

    document.querySelectorAll('svg').forEach((node, index) => {
      // An inline mark: taken as the drawing itself, not as a file to fetch.
      const clone = node.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox') && node.viewBox && node.viewBox.baseVal) {
        const box = node.viewBox.baseVal;
        if (box.width) clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
      }
      found.push({ kind: 'inline', url: `inline svg #${index}`,
                   markup: clone.outerHTML,
                   words: [node.getAttribute('aria-label'), node.getAttribute('class'), node.id].join(' '),
                   alt: node.getAttribute('aria-label') || '', ...place(node) });
    });

    /* A mark set in CSS. Painted as a background, cut out as a mask so the
       site can recolour it, or drawn on the element's own ::before — all three
       are marks a scan that only reads background-image cannot see. */
    document.querySelectorAll('a, div, span, h1, i').forEach((node) => {
      // The element itself and what it draws before and after it: a mark is as
      // often set on a pseudo-element as on the box.
      const styles = [getComputedStyle(node), getComputedStyle(node, '::before'),
                      getComputedStyle(node, '::after')];
      const pictures = [];
      styles.forEach((style) => {
        // content: url() as well — an empty div that nonetheless shows a mark is
        // usually doing it that way.
        pictures.push(style.backgroundImage, style.maskImage, style.webkitMaskImage, style.content);
      });
      pictures.forEach((picture) => {
        const match = picture && picture !== 'none' && picture.match(/url\(["']?(.+?)["']?\)/);
        if (!match || match[1].startsWith('data:')) return;
        found.push({ kind: 'css', url: new URL(match[1], location.href).href, alt: '',
                     words: [node.className, node.id, node.getAttribute('name'),
                             node.getAttribute('alt'), node.getAttribute('aria-label')].join(' '),
                     ...place(node) });
      });
    });

    return found;
  }));
}

function score(item) {
  const text = ((item.words || '') + ' ' + item.url).toLowerCase();
  // Not a mark: the things a site's header also carries.
  // Whole words: the group whose name begins "Socialists" must not be thrown
  // out for looking like a share button.
  if (/(^|[^a-z])(sprite|social(s|-|_|$)|share|facebook|twitter|instagram|linkedin|youtube|search|menu|burger|arrow|flag|favicon)/.test(text) ||
      /icon[-_/]/.test(text)) return 0;
  // A faded copy of a mark is not the mark.
  if (/opacity|watermark|placeholder|shadow/.test(text)) return 0;
  if (item.width && (item.width < 24 || item.height < 12)) return 0;
  if (item.width && item.width / Math.max(item.height, 1) > 12) return 0;
  // A mark is a mark, not a photograph across the top of the page.
  if (item.width > 620 || item.height > 320) return 0;

  let points = 0;
  if (/logo|brand|mark/.test(text)) points += 4;
  if (item.inHeader) points += 3;
  if (item.goesHome) points += 4;
  // Drawn where a reader can see it. A thing with no size is a definition, a
  // hidden copy, or something a script has not shown yet — never the mark.
  if (item.width >= 40 && item.height >= 12) points += 5;
  else points -= 3;
  if (item.top >= 0 && item.top < 200) points += 2;
  if (item.left >= 0 && item.left < 400) points += 1;
  if (/\.svg($|\?)/.test(item.url.toLowerCase())) points += 2;
  return points;
}

async function bytes(url) {
  // Straight out of the browser's network stack, which no cross-origin rule
  // stands in front of. Most marks are served from a CDN, so this is the path
  // that usually works; the in-page fetch below is the fallback for anything
  // that needs the page's own session.
  try {
    const direct = await context.request.get(url, { timeout: 30000 });
    if (direct.ok()) {
      const buffer = await direct.body();
      if (buffer && buffer.length) return { status: direct.status(), buffer };
    }
  } catch (error) {
    // fall through to asking the page
  }

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

/* Read the kind from the bytes, not from the name: a mark served without an
   extension is still a mark, and a name is not evidence. */
function kind(buffer) {
  if (!buffer || buffer.length < 64) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  const head = buffer.toString('utf8', 0, 2000).toLowerCase();
  if (head.includes('<svg')) return 'svg';
  return null;
}

let saved = 0;
const report = [];

for (const group of wanted) {
  const site = SITES[group];
  requested.clear();
  try {
    await page.goto(site, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1800);
    // A consent banner can sit over the header; the mark is in the page either
    // way, but dismissing it lets the page settle.
    for (const label of ['Accept all', 'Accept', 'I agree', 'Allow all', 'OK']) {
      const button = page.getByRole('button', { name: label, exact: false }).first();
      if (await button.count().catch(() => 0)) {
        await button.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(600);
        break;
      }
    }
  } catch (error) {
    console.warn(`${group}: could not open ${site} — ${error.message}`);
    continue;
  }

  if (has('--probe') && only.length) {
    const pictures = [...requested.entries()]
      .filter(([url]) => !/mepphoto|\/photo\/|\/photos\/|getty/i.test(url));
    console.log(`\n${group}: ${pictures.length} pictures fetched (of ${requested.size}), ` +
      'photographs set aside:');
    pictures.slice(0, 40).forEach(([url, type]) => console.log(`   ${type.padEnd(16)} ${url.slice(0, 140)}`));
  }

  if (has('--probe') && only.length) {
    // Asked about one group: show what its header is actually made of, which is
    // the only way to see a mark the scoring cannot — printed before anything
    // else decides, so a named mark does not hide it.
    const head = await settled(() => page.evaluate(() => {
      const bar = document.querySelector('header, [role="banner"], .header, #header, .site-header');
      return bar ? bar.innerHTML.replace(/\s+/g, ' ').slice(0, 2600) : '(no header element)';
    }));
    console.log(`\n${group} header: ${head}\n`);
  }

  // A named mark is taken as given; everything else is found by looking.
  if (MARK[group]) {
    let took = false;
    for (const address of [].concat(MARK[group])) {
      const answer = await bytes(address);
      const type = kind(answer.buffer);
      if (!type) {
        console.warn(`  ${group}: ${address} came back as nothing usable (${answer.status || 'no answer'})`);
        continue;
      }
      const file = `${slug(group)}.${type}`;
      if (!has('--probe')) await writeFile(path.join(ROOT, OUT, file), answer.buffer);
      console.log(`  ${group} -> ${file} (${answer.buffer.length}b, named) ${address}`);
      report.push({ group, file, from: address, page: page.url() });
      saved += 1;
      took = true;
      break;
    }
    if (took) continue;
  }

  const ranked = (await candidates())
    .map((item) => ({ item, points: score(item) }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points);

  if (has('--probe')) {
    console.log(`\n${group} — ${page.url()}`);
    ranked.slice(0, 12).forEach((entry) => {
      const item = entry.item;
      console.log(`  ${String(entry.points).padStart(2)} ${item.kind.padEnd(6)} ` +
        `${item.width}x${item.height} @${item.left},${item.top}` +
        `${item.inHeader ? ' header' : ''}${item.goesHome ? ' home' : ''}  ` +
        `${item.url.slice(0, 90)}${item.alt ? '  [' + item.alt.slice(0, 40) + ']' : ''}`);
    });
    console.log(`  ${ranked.length} of ${(await candidates()).length} pictures scored above zero`);

  }

  let taken = false;
  for (const entry of ranked.slice(0, 6)) {
    const item = entry.item;
    let buffer = null;
    let type = null;

    if (item.kind === 'inline') {
      buffer = Buffer.from(item.markup, 'utf8');
      type = kind(buffer);
    } else {
      const answer = await bytes(item.url);
      buffer = answer.buffer;
      type = kind(buffer);
    }
    if (!type) continue;

    const file = `${slug(group)}.${type}`;
    if (!has('--probe')) await writeFile(path.join(ROOT, OUT, file), buffer);
    console.log(`  ${group} -> ${file} (${buffer.length}b, ${entry.points} points) ` +
      `${item.kind === 'inline' ? page.url() + ' (inline)' : item.url}`);
    report.push({ group, file, from: item.kind === 'inline' ? page.url() : item.url, page: page.url() });
    saved += 1;
    taken = true;
    break;
  }
  if (!taken) console.warn(`  ${group}: nothing usable on ${site}`);

  await page.waitForTimeout(400);
}

await browser.close();

if (!has('--probe') && report.length) {
  /* Where each mark came from, in the repository, so the licence question has
     an answer that is not "somebody downloaded it once". */
  const existing = await readFile(path.join(ROOT, OUT, 'sources.json'), 'utf8')
    .then((text) => JSON.parse(text).marks || []).catch(() => []);
  const marks = existing.filter((old) => !report.some((one) => one.group === old.group)).concat(report);
  await writeFile(
    path.join(ROOT, OUT, 'sources.json'),
    JSON.stringify({
      note: 'Each political group\'s mark and the page it was taken from. The ' +
        'Parliament does not publish these, so each comes from that group\'s own ' +
        'site, and identifies that group.',
      taken: new Date().toISOString().slice(0, 10),
      marks: marks.sort((a, b) => a.group.localeCompare(b.group))
    }, null, 2) + '\n'
  );
}

console.log(`\n${saved} of ${wanted.length} group marks ${has('--probe') ? 'found' : 'written'}.`);
process.exit(saved ? 0 : 1);
