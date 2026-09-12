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
 * It reads and reports; it changes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';

const PAGES = [
  ['Chrome: what makes a site installable',
   'https://developer.chrome.com/docs/devtools/progressive-web-apps',
   ['service worker', 'installab', 'manifest', 'icon']],
  ['Chrome: the install criteria',
   'https://web.dev/articles/install-criteria',
   ['service worker', 'fetch handler', 'criteria', 'manifest', '192', '512', 'HTTPS']],
  ['MDN: making a PWA installable',
   'https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable',
   ['service worker', 'manifest', 'icons', 'start_url', 'display', 'required']],
  ['MDN: the web app manifest members a browser reads',
   'https://developer.mozilla.org/en-US/docs/Web/Manifest',
   ['id', 'scope', 'start_url', 'maskable', 'display']],
  ['Apple: adding a web app to the Home Screen',
   'https://developer.apple.com/documentation/webkit/adding-a-web-app-manifest',
   ['apple-touch-icon', 'manifest', 'Home Screen', 'standalone']]
];

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

for (const [name, url, tells] of PAGES) {
  console.log('\n' + '='.repeat(78));
  console.log(name);
  console.log(url);
  console.log('='.repeat(78));
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    console.log('  status ' + (response ? response.status() : '?') +
      ', ' + text.replace(/\s/g, '').length + ' chars');
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
