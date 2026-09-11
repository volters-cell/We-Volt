#!/usr/bin/env node
/*
 * Can a web page post straight to an Instagram Story?
 *
 * Asked three times, answered from memory twice. This asks the people who
 * decide: Instagram's own "Sharing to Stories" documentation, and the web
 * platform specs for the two things such a hand-off would need — writing an
 * arbitrary type to the clipboard, and opening another app with a payload.
 *
 * It reads and reports; it changes nothing. If the answer has moved, this is
 * where that shows up.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';

const PAGES = [
  ['Instagram: sharing to stories (iOS)',
   'https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/ios'],
  ['Instagram: sharing to stories (Android)',
   'https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/android'],
  ['Instagram: sharing to stories (overview)',
   'https://developers.facebook.com/docs/instagram-platform/sharing-to-stories'],
  ['MDN: Clipboard.write (what types a page may put on the clipboard)',
   'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write'],
  ['MDN: navigator.share (what a page may hand to another app)',
   'https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share']
];

/* The words that decide the answer. A hand-off needs a registered app id and
   a pasteboard the page cannot write; if those requirements have gone, so has
   the limitation. */
const TELLS = [
  'source_application', 'Facebook App ID', 'app ID', 'pasteboard', 'UIPasteboard',
  'com.instagram.sharedSticker', 'instagram-stories://', 'ADD_TO_STORY',
  'LSApplicationQueriesSchemes', 'native', 'Info.plist',
  'text/plain', 'image/png', 'custom', 'not permitted', 'only'
];

const browser = await chromium.launch();
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  locale: 'en-GB'
});
const page = await context.newPage();

for (const [name, url] of PAGES) {
  console.log('\n' + '='.repeat(78));
  console.log(name);
  console.log(url);
  console.log('='.repeat(78));
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    console.log('  status ' + (response ? response.status() : '?') +
      ', ' + text.replace(/\s/g, '').length + ' chars');
    if (text.replace(/\s/g, '').length < 400) { console.log('  (no readable body)'); continue; }

    for (const tell of TELLS) {
      const hit = text.toLowerCase().indexOf(tell.toLowerCase());
      if (hit === -1) continue;
      const line = text.slice(Math.max(0, hit - 130), hit + 190).replace(/\s+/g, ' ').trim();
      console.log('  · ' + tell + ': …' + line + '…');
    }
  } catch (error) {
    console.log('  FAILED ' + String(error.message).split('\n')[0].slice(0, 90));
  }
}
await browser.close();
