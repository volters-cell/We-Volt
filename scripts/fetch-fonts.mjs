#!/usr/bin/env node
/*
 * Bring the fonts into this repository, so a reader is not announced to Google.
 *
 * Every page carried <link href="https://fonts.googleapis.com/css2?…">, which
 * means every visitor's browser asks Google for the stylesheet and then asks
 * fonts.gstatic.com for the files — handing over an IP address, a user agent
 * and a referrer naming the page, on a site whose About page says the records
 * are mirrored on EU infrastructure. The fonts are the one thing on it that
 * contradicted what it says about itself.
 *
 * IBM Plex Sans and Source Serif 4 are both under the SIL Open Font License,
 * which permits redistribution. So they are fetched once, here, and served
 * from the same origin as everything else.
 *
 * Google returns a different stylesheet depending on who is asking: without a
 * modern user agent it offers TrueType, which is three times the size of
 * woff2. So it is asked as a current browser, and what comes back is parsed
 * rather than guessed at — every url() in it is downloaded and the stylesheet
 * rewritten to point beside itself.
 *
 * Run by .github/workflows/fonts.yml, because this sandbox cannot reach
 * fonts.gstatic.com.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'assets/fonts';

/* One request covering every weight any page or card asks for: the pages want
   400, 500, 600 and a 400 italic; the share cards want 400, 600 and 700. */
const CSS_URL = 'https://fonts.googleapis.com/css2' +
  '?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400' +
  '&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700' +
  '&display=swap';

// Chrome. Ask as anything older and Google serves TrueType instead of woff2.
const AS_A_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function fetchOrThrow(url, options) {
  const answer = await fetch(url, options);
  if (!answer.ok) throw new Error(`${url} responded ${answer.status}`);
  return answer;
}

/* fonts.gstatic.com/s/ibmplexsans/v24/abc123.woff2 -> ibmplexsans-v24-abc123.woff2,
   which keeps two files of the same family and different subsets apart. */
function localName(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return parts.slice(-3).join('-').replace(/[^\w.-]/g, '-');
}

const css = await (await fetchOrThrow(CSS_URL, { headers: { 'User-Agent': AS_A_BROWSER } })).text();
if (!/woff2/.test(css)) throw new Error('Google served no woff2 — the user agent is too old.');

const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]
  .map((match) => match[1]))];
if (!urls.length) throw new Error('No font files named in the stylesheet.');

await mkdir(path.join(ROOT, OUT), { recursive: true });

let written = 0;
let bytes = 0;
let rewritten = css;
for (const url of urls) {
  const name = localName(url);
  const file = Buffer.from(await (await fetchOrThrow(url)).arrayBuffer());
  await writeFile(path.join(ROOT, OUT, name), file);
  rewritten = rewritten.split(url).join(name);
  written += 1;
  bytes += file.length;
}

const header = `/* IBM Plex Sans and Source Serif 4, served from this site rather than from
   Google, so that reading a vote does not report the reader to a third party.

   Both are under the SIL Open Font License 1.1, which permits this. See
   OFL.txt beside this file.

   Written by scripts/fetch-fonts.mjs from ${CSS_URL} — do not edit by hand;
   run the workflow again instead. */

`;
await writeFile(path.join(ROOT, OUT, 'fonts.css'), header + rewritten, 'utf8');

const licence = `IBM Plex Sans — Copyright 2017 IBM Corp.
Source Serif 4 — Copyright 2014-2021 Adobe (http://www.adobe.com/).

Both families are licensed under the SIL Open Font License, Version 1.1.
The licence permits use, study, modification and redistribution, including
serving the fonts from your own site, provided the fonts are not sold on
their own and any modified version is not distributed under the original
reserved names.

Full text: https://openfontlicense.org/open-font-license-official-text/
Upstream:  https://github.com/IBM/plex
           https://github.com/adobe-fonts/source-serif
`;
await writeFile(path.join(ROOT, OUT, 'OFL.txt'), licence, 'utf8');

console.log(`${written} font files, ${(bytes / 1024).toFixed(0)} KB, and a stylesheet in ${OUT}/.`);
console.log('Pages should now load assets/fonts/fonts.css and nothing from Google.');
