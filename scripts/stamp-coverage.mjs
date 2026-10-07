#!/usr/bin/env node
/* Fill the About page's completeness figures from the latest audit.
 *
 * The table used to be typed in by hand, once, from the audit of 24 August
 * 2026, and it went on saying 647 votes held and 112 sittings while the
 * monthly audit counted more every time. Every figure in it is now marked
 * with the field of data/reference/coverage.json it comes from —
 * <td data-coverage="onFile"> — and this writes the audit's number into it.
 * The pages workflow runs it before publishing, so the page always says what
 * the latest audit found.
 *
 * The one sentence that claims completeness is rewritten when the audit found
 * votes missing, rather than left to say what is not true.
 *
 *   node scripts/stamp-coverage.mjs           # write into about.html
 *   node scripts/stamp-coverage.mjs --check   # say what would change
 *
 *   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'about.html');
const CHECK = process.argv.includes('--check');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const spoken = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const count = (value) => (Array.isArray(value) ? value.length : Number(value) || 0);
const number = (value) => count(value).toLocaleString('en-GB');

export function figures(report) {
  const missing = count(report.missing);
  return {
    checked: spoken(report.checked),
    since: spoken(report.window.from),
    sittings: number(report.sittings),
    rollCallVotes: number(report.rollCallVotes),
    finalVotes: number(report.finalVotes),
    onFile: number(report.onFile),
    unpublished: number(report.unpublished),
    disagreeing: number(report.disagreeing),
    amendments: (count(report.rollCallVotes) - count(report.finalVotes)).toLocaleString('en-GB'),
    verdict: missing || count(report.disagreeing)
      ? `On that date ${missing.toLocaleString('en-GB')} vote${missing === 1 ? '' : 's'} on a text ` +
        'with ballots published at the Parliament ' + (missing === 1 ? 'was' : 'were') +
        ' not yet here, and ' + number(report.disagreeing) + ' tall' +
        (count(report.disagreeing) === 1 ? 'y' : 'ies') + ' disagreed with theirs; the audit ' +
        'imports what it finds missing.'
      : 'So every vote on a text for which the Parliament publishes individual ballots is here, ' +
        'and every tally matches theirs.'
  };
}

export function stamp(html, values) {
  return html.replace(/(<(\w+)\b[^>]*\bdata-coverage="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    function (whole, open, tag, key, inner, close) {
      return key in values ? open + values[key] + close : whole;
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = JSON.parse(await readFile(path.join(ROOT, 'data/reference/coverage.json'), 'utf8'));
  const before = await readFile(PAGE, 'utf8');
  const after = stamp(before, figures(report));
  if (after === before) {
    console.log('about.html already carries the latest audit.');
  } else if (CHECK) {
    console.log('about.html would be updated from the audit of ' + report.checked + '.');
  } else {
    await writeFile(PAGE, after, 'utf8');
    console.log('about.html — figures from the audit of ' + report.checked + '.');
  }
}
