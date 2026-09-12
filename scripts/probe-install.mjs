#!/usr/bin/env node
/*
 * What does a browser actually require before it offers to install a site?
 *
 * The manifest and the icons are the part everyone knows about. The part that
 * is remembered wrongly is whether a service worker is still required — it was
 * for years, and the answer has moved. Rather than guess, this reads what
 * Chrome and MDN currently publish and prints the sentences that decide it,
 * so the next person can see the answer rather than take it on trust.
 *
 * As of the run on 2026-09-12 it is not required, and both say so plainly.
 * Chrome's list is HTTPS, a manifest with name or short_name, a 192 and a 512
 * icon, start_url, a display of fullscreen / standalone / minimal-ui /
 * window-controls-overlay, and prefer_related_applications absent or false —
 * no service worker in it. MDN: "While not a requirement for a PWA to be
 * installable, many PWAs use service workers to provide an offline
 * experience." This site meets the list without one, so it does not have one:
 * a cache in front of a site whose whole problem was being served stale would
 * be a step backwards, and the offline reading it would buy is not what
 * anybody asked for.
 *
 * It reads and reports; it changes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';

const PAGES = [
  [['Chrome: what makes a site installable',
    'https://developer.chrome.com/docs/devtools/progressive-web-apps'],
   ['service worker', 'installab', 'manifest', 'icon']],
  [['Chrome: the install criteria',
    'https://web.dev/articles/install-criteria'],
   ['service worker', 'fetch handler', 'criteria', 'manifest', '192', '512', 'HTTPS']],
  [['MDN: making a PWA installable',
    'https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable'],
   ['service worker', 'manifest', 'icons', 'start_url', 'display', 'required']],
  [['MDN: the web app manifest members a browser reads',
    'https://developer.mozilla.org/en-US/docs/Web/Manifest'],
   ['id', 'scope', 'start_url', 'maskable', 'display']],
  /* Apple moves its documentation and leaves nothing behind, so this is a
     list rather than an address: the first one that answers is read, and a
     run that finds none of them says so instead of quietly reporting a 404 as
     an answer. */
  [['Apple: web apps on the Home Screen',
    'https://developer.apple.com/documentation/webkit/configuring-your-web-application',
    'https://developer.apple.com/documentation/webkit/adding-a-web-app-manifest',
    'https://webkit.org/blog/8042/meet-face-id-and-touch-id-for-the-web/'],
   ['apple-touch-icon', 'manifest', 'Home Screen', 'standalone']]
];

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

for (const [head, tells] of PAGES) {
  /* One address, or a name followed by the addresses to try in turn. */
  const name = Array.isArray(head) ? head[0] : head;
  const urls = Array.isArray(head) ? head.slice(1) : [head];
  console.log('\n' + '='.repeat(78));
  console.log(name);
  console.log('='.repeat(78));
  try {
    let response = null;
    let url = null;
    for (const candidate of urls) {
      url = candidate;
      response = await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && response.status() < 400) break;
      if (urls.length > 1) console.log('  ' + candidate + ' — ' +
        (response ? response.status() : 'no response') + ', trying the next');
    }
    console.log('  ' + url);
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    console.log('  status ' + (response ? response.status() : '?') +
      ', ' + text.replace(/\s/g, '').length + ' chars');
    if (response && response.status() >= 400) {
      console.log('  NOT READ — every address for this one answered with an error.');
      console.log('  Find where it moved to and put the new address at the front of the list.');
      continue;
    }
    if (text.replace(/\s/g, '').length < 400) { console.log('  (no readable body)'); continue; }

    for (const tell of tells) {
      let from = 0;
      for (let seen = 0; seen < 2; seen++) {
        const hit = text.toLowerCase().indexOf(tell.toLowerCase(), from);
        if (hit === -1) break;
        const line = text.slice(Math.max(0, hit - 170), hit + 230).replace(/\s+/g, ' ').trim();
        console.log('  · ' + tell + ': …' + line + '…');
        from = hit + tell.length;
      }
    }
  } catch (error) {
    console.log('  FAILED ' + String(error.message).split('\n')[0].slice(0, 90));
  }
}
await browser.close();
