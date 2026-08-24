#!/usr/bin/env node
/*
 * Fetch the Parliament's plenary calendar: when each session runs, and whether
 * it sits in Strasbourg or Brussels.
 *
 *   node scripts/fetch-sessions.mjs                 # this term so far
 *   node scripts/fetch-sessions.mjs --term 10
 *   node scripts/fetch-sessions.mjs --until 2027-12-31
 *
 * One source, the Parliament's open data portal:
 *
 *   /meetings?year=YYYY   every sitting of a year, each with its date, its
 *                         parliamentary term and its locality
 *
 * A locality ending FRA_SXB is Strasbourg, BEL_BRU is Brussels. Consecutive
 * sitting days are folded into one session, which is how the Parliament itself
 * speaks of them — "the July session" — and how the site groups its votes.
 *
 * Writes data/reference/plenary-calendar.json, which the site reads to say when
 * the last session was and when the next one starts.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PORTAL, getAll, english, lastSegment } from './lib/portal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'data/reference/plenary-calendar.json';
const TERM = 10;
const TERM_START = '2024-07-16';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = !next || next.startsWith('--') ? true : (i += 1, next);
  }
  return args;
}

/* The portal names a term "org/ep-10", not "10". */
export function termNumber(value) {
  const match = String(value || '').match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

export function locationOf(meeting) {
  const locality = [].concat(meeting.hasLocality || meeting.had_activity_location || [])
    .map(function (entry) { return typeof entry === 'string' ? entry : (entry && entry.id) || ''; })
    .find(Boolean);
  const code = lastSegment(locality);
  if (!code) return null;
  if (code.endsWith('FRA_SXB')) return 'Strasbourg';
  if (code.endsWith('BEL_BRU')) return 'Brussels';
  return null;
}

/* One sitting day per meeting. Days that touch — allowing for the weekend a
   session never crosses — belong to the same session. */
export function foldSessions(days) {
  const sessions = [];
  days.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (day) {
    const last = sessions[sessions.length - 1];
    const gap = last
      ? (new Date(day.date + 'T00:00:00Z') - new Date(last.end + 'T00:00:00Z')) / 86400000
      : Infinity;
    if (last && gap <= 1 && (!day.location || !last.location || day.location === last.location)) {
      last.end = day.date;
      last.location = last.location || day.location;
      last.days += 1;
      return;
    }
    sessions.push({ start: day.date, end: day.date, location: day.location, days: 1 });
  });
  return sessions;
}

export async function fetchSittings(term, from, until) {
  const days = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(until.slice(0, 4)); year += 1) {
    const meetings = await getAll('/meetings', { year: year }, 400);
    meetings.forEach(function (meeting) {
      const date = meeting.activity_date;
      if (!date || date < from || date > until) return;
      if (meeting.had_activity_type && meeting.had_activity_type.indexOf('PLENARY') === -1) return;
      if (meeting.parliamentary_term && termNumber(meeting.parliamentary_term) !== term) return;
      days.push({ date: date, location: locationOf(meeting), label: english(meeting.activity_label) });
    });
  }
  return days;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const term = Number(args.term || TERM);
  const from = typeof args.from === 'string' ? args.from : TERM_START;
  const until = typeof args.until === 'string'
    ? args.until
    : new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);

  const days = await fetchSittings(term, from, until);
  if (!days.length) throw new Error('The portal returned no sittings — check the term and the dates.');

  const sessions = foldSessions(days);
  const today = new Date().toISOString().slice(0, 10);
  const past = sessions.filter((session) => session.end < today);
  const upcoming = sessions.filter((session) => session.end >= today);

  await writeFile(path.join(ROOT, OUT), JSON.stringify({
    metadata: {
      term: term,
      fetched: today,
      source: `${PORTAL}/meetings?year={year}`,
      note: 'One entry per plenary session, folded from the sitting days the Parliament ' +
        'records. A null location means the meeting record did not name one.'
    },
    sessions: sessions
  }, null, 2) + '\n', 'utf8');

  console.log(`${OUT} — ${sessions.length} sessions from ${days.length} sitting days, ` +
    `${past.length} past, ${upcoming.length} upcoming`);
  const strasbourg = past.filter((session) => session.location === 'Strasbourg');
  if (strasbourg.length) {
    const last = strasbourg[strasbourg.length - 1];
    console.log(`Last Strasbourg session: ${last.start} to ${last.end}`);
  }
  if (upcoming.length) {
    console.log(`Next session: ${upcoming[0].start} (${upcoming[0].location || 'location unknown'})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
