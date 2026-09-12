#!/usr/bin/env node
/*
 * What does it cost to run this site for a year?
 *
 * The answer is meant for a grant application, so it should not be a figure
 * anyone remembers. This reads GitHub's own published limits and billing
 * terms, prints the sentences that carry the numbers, and then measures this
 * site against them: how much is uploaded, and how much is downloaded by one
 * visit. If a limit moves, or the site grows past one, this is where it shows.
 *
 * It reads and reports; it changes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const PAGES = [
  ['GitHub Pages: limits and what it costs',
   'https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits',
   ['1 GB', '100 GB', '10 builds', 'soft bandwidth', 'usage limit', 'published site']],
  ['GitHub Pages: which plans include it',
   'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages',
   ['public repositor', 'free', 'GitHub Free', 'available in']],
  ['GitHub Actions: what it is billed at',
   'https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions',
   ['free for public', 'public repositor', 'standard runners', 'included', 'minutes']],
  ['GitHub Pages: a custom domain, if one is ever wanted',
   'https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages',
   ['domain registrar', 'HTTPS', 'free']]
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
    const text = await page.evaluate(() => document.body ? document.body.innerText : '');
    console.log('  status ' + (response ? response.status() : '?') +
      ', ' + text.replace(/\s/g, '').length + ' chars');
    if (text.replace(/\s/g, '').length < 400) { console.log('  (no readable body)'); continue; }

    for (const tell of tells) {
      let from = 0;
      for (let seen = 0; seen < 2; seen++) {
        const hit = text.toLowerCase().indexOf(tell.toLowerCase(), from);
        if (hit === -1) break;
        const line = text.slice(Math.max(0, hit - 150), hit + 210).replace(/\s+/g, ' ').trim();
        console.log('  · ' + tell + ': …' + line + '…');
        from = hit + tell.length;
      }
    }
  } catch (error) {
    console.log('  FAILED ' + String(error.message).split('\n')[0].slice(0, 90));
  }
}

/* Now the site, against those limits. The first number is what a publish
   uploads; the second is what one reader's browser pulls down. */
console.log('\n' + '='.repeat(78));
console.log('This site, measured');
console.log('='.repeat(78));

const kb = bytes => (bytes / 1024).toFixed(0) + ' KB';
const mb = bytes => (bytes / 1024 / 1024).toFixed(1) + ' MB';

const uploaded = Number(execSync(
  "du -sb --exclude=.git --exclude=node_modules . | cut -f1", { encoding: 'utf8' }).trim());
console.log('  uploaded to Pages          ' + mb(uploaded));

/* One visit: the shell, then the records the tracker boots with, then the
   five portraits and the one vote it opens on. Text is served compressed,
   so the shell is weighed compressed; the portraits are already JPEG. */
const { gzipSync } = await import('node:zlib');
const { readFileSync, readdirSync, statSync } = await import('node:fs');

const shell = ['index.html', 'assets/css/style.css',
  ...readdirSync('assets/js').filter(f => f.endsWith('.js')).map(f => 'assets/js/' + f),
  'data/decisions/index.json', 'data/eu-countries.geo.json', 'data/meps/index.json',
  ...readdirSync('data/reference').filter(f => f.endsWith('.json')).map(f => 'data/reference/' + f)
].reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0);

const faces = readdirSync('assets/faces').slice(0, 5)
  .reduce((total, f) => total + statSync('assets/faces/' + f).size, 0);

const votes = readdirSync('data/decisions').filter(f => f !== 'index.json');
const oneVote = gzipSync(readFileSync('data/decisions/' + votes[0])).length;

const visit = shell + faces + oneVote;
console.log('  shell + boot records       ' + kb(shell) + ' (compressed, as served)');
console.log('  five portraits             ' + kb(faces));
console.log('  the vote it opens on       ' + kb(oneVote));
console.log('  one first visit            ' + kb(visit));
console.log('  visits inside 100 GB/mo    ' +
  Math.floor(100 * 1024 ** 3 / visit).toLocaleString('en-GB'));

await browser.close();
