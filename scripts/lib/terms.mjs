/* Which Parliament a date belongs to, read from data/reference/terms.json.

   The boundaries used to be written into eight places — the index, the
   minutes addresses, the audit, the calendar, the seat counts, the page — and
   each would have gone on filing votes under "2024–2029" after the next
   election. They now live in one file, which scripts/fetch-sessions.mjs
   extends the first time the Parliament's own data lists a sitting of a new
   term.

   SPDX-License-Identifier: AGPL-3.0-or-later
*/
import { readFileSync } from 'node:fs';

export const TERMS_FILE = new URL('../../data/reference/terms.json', import.meta.url);

export function loadTerms(file = TERMS_FILE) {
  const rows = JSON.parse(readFileSync(file, 'utf8')).terms || [];
  return rows.slice().sort((a, b) => (a.start < b.start ? 1 : -1));
}

const TERMS = loadTerms();

/* Newest first. */
export function allTerms() {
  return TERMS.slice();
}

/* The term a date falls in: the latest that had begun by then. A date before
   the earliest on file is counted in the earliest. */
export function termOf(date, terms = TERMS) {
  const found = terms.find((row) => date >= row.start) || terms[terms.length - 1];
  return found ? found.term : null;
}

/* The term sitting today (or on the date given). */
export function currentTerm(today = new Date().toISOString().slice(0, 10), terms = TERMS) {
  return terms.find((row) => today >= row.start) || terms[terms.length - 1];
}

/* "2024–2029": a Parliament is elected for five years. */
export function spanOf(term, terms = TERMS) {
  const row = terms.find((item) => item.term === term);
  if (!row) return '';
  const year = Number(row.start.slice(0, 4));
  return `${year}–${year + 5}`;
}

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth',
  'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth'];

/* "This Parliament" for the newest, "Previous Parliament" for the one before,
   and its ordinal for any earlier — "Eighth Parliament". */
export function labelOf(term, newest) {
  if (term === newest) return 'This Parliament';
  if (term === newest - 1) return 'Previous Parliament';
  return (ORDINALS[term] || `Term ${term}`) + ' Parliament';
}

/* The terms the portal lists that are not on file yet, each with the date of
   its first plenary sitting. `days` is [{ date, term }] as read from the
   portal's meetings. Pure, so it can be tested. */
export function newTerms(known, days) {
  const newest = Math.max(...known.map((row) => row.term));
  const first = new Map();
  days.forEach(function (day) {
    if (!day.term || day.term <= newest) return;
    if (!first.has(day.term) || day.date < first.get(day.term)) first.set(day.term, day.date);
  });
  return [...first.entries()]
    .map(([term, start]) => ({ term, start }))
    .sort((a, b) => b.term - a.term);
}
