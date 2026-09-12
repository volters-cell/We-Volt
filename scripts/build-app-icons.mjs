#!/usr/bin/env node
/*
 * The icons a phone needs to put this site on a home screen.
 *
 * "Add to Home Screen" is not a switch anyone turns on: a browser offers it
 * when the site says what it is called, where it starts, and what it looks
 * like as an icon. The first two are in manifest.webmanifest. This writes the
 * third — the same Volt mark the footer uses, white on the party's purple,
 * at the four sizes the platforms actually read.
 *
 * They are committed rather than built at publish time. There are five of
 * them, they weigh a few kilobytes, and they never change: they derive from a
 * mark that is itself a fixed file. Building them would put a browser in the
 * way of a checkout serving correctly, which the README promises it does.
 * Run this again only if the mark or the purple changes.
 *
 *   node scripts/build-app-icons.mjs
 *
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PURPLE = '#502379';          // the party's own, as used by .join
const OUT = 'assets/icons';

/* The mark exactly as Volt publishes it: one shape, no colour of its own.
   Everything here paints it white, which is how the party uses it on a dark
   ground. */
const MARK = readFileSync('assets/brand/volt.svg', 'utf8');
/* Self-closed on the way out. Volt's file writes each path as a tag pair, and
   lifting only the opening tags nests them one inside the next, where a
   browser draws the outermost and silently drops the rest — an icon with the
   "t" of Volt and nothing else. */
const paths = MARK.match(/<path[^>]*?\/?>/g)
  .map(tag => tag.replace(/\/?>$/, '/>'))
  .join('');
if (paths.split('<path').length - 1 !== 4) {
  throw new Error('expected the four shapes of the Volt mark, found ' +
    (paths.split('<path').length - 1));
}
const VIEWBOX = '0 0 230 96';

/* size      what reads it
   512       Android's install prompt and splash
   512 mask  Android again, cropped to whatever shape the launcher uses, so the
             mark sits inside the 80% safe circle rather than against the edge
   192       the manifest's everyday icon
   180       iOS, which ignores the manifest and reads apple-touch-icon

   The browser tab keeps the small drawn mark it already had: a wordmark four
   pixels tall is not a wordmark. */
const ICONS = [
  { file: 'icon-512.png', size: 512, mark: .62 },
  { file: 'icon-512-maskable.png', size: 512, mark: .44 },
  { file: 'icon-192.png', size: 192, mark: .62 },
  { file: 'apple-touch-icon.png', size: 180, mark: .62 }
];

const page = html => `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { width: 100vw; height: 100vh; display: grid; place-items: center;
         background: ${PURPLE}; }
  svg { display: block; }
</style>${html}`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined
});

for (const icon of ICONS) {
  const view = await browser.newPage({
    viewport: { width: icon.size, height: icon.size },
    deviceScaleFactor: 1
  });
  const width = Math.round(icon.size * icon.mark);
  await view.setContent(page(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" ` +
    `width="${width}" height="${Math.round(width * 96 / 230)}" ` +
    `fill="#ffffff">${paths}</svg>`));
  await view.screenshot({ path: `${OUT}/${icon.file}`, omitBackground: false });
  await view.close();
  console.log(`  ${icon.file.padEnd(24)} ${icon.size}×${icon.size}, mark ${width}px wide`);
}

await browser.close();
console.log(`\nWritten to ${OUT}/. Reference them from manifest.webmanifest.`);
