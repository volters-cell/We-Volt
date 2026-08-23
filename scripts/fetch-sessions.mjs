#!/usr/bin/env node
/*
 * Fetch the Parliament's plenary calendar: when each session runs, and whether
 * it sits in Strasbourg or Brussels.
 *
 *   node scripts/fetch-sessions.mjs                 # current term
 *   node scripts/fetch-sessions.mjs --term 10
 *   node scripts/fetch-sessions.mjs --no-locations  # skip the per-session lookup
 *   node scripts/fetch-sessions.mjs --file saved.json
 *
 * Two sources, both the Parliament's own:
 *
 *   1. The session calendar behind the plenary pages, which lists every sitting
 *      day of a term:
 *      /plenary/en/ajax/getSessionCalendar.html?family=PV&termId={term}
 *      It has one entry per day; entries are folded into one item per session.
 *
 *   2. The Open Data Portal's meeting record, which carries the locality:
 *      data.europarl.europa.eu/api/v1/meetings/MTG-PL-{YYYY-MM-DD}
 *      A locality ending FRA_SXB is Strasbourg, BEL_BRU is Brussels.
 *
 * Writes data/reference/plenary-calendar.json, which the site reads to say when
 * the last session was and when the next one starts, and which the roll-call
 * importer reads so it only looks for votes on days the Parliament actually sat.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseXML, findAll } from './lib/xml.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = 'data/reference/plenary-calendar.json';
const TERM = 10;

const CALENDAR_URL = (term) =>
  `https://www.europarl.europa.eu/plenary/en/ajax/getSessionCalendar.html?family=PV&termId=${term}`;
const MEETING_URL = (date) =>
  `https://data.europarl.europa.eu/api/v1/meetings/MTG-PL-${date}`;

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

async function get(url, accept) {
  const response = await fetch(url, {
    headers: { accept: accept, 'user-agent': 'eu-tracker/0.1 (open data import)' },
    redirect: 'follow'
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

const pad = (value) => String(value).padStart(2, '0');

/* The calendar has one entry per sitting day. Entries that share a start date
   belong to the same session, so folding on that gives one item per session. */
export function parseCalendar(payload) {
  const doc = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const days = doc.sessionCalendar || doc.sessions || [];
  const sessions = new Map();

  days.forEach(function (day) {
    const year = day.year || day.sessionYear;
    const start = `${year}-${pad(day.monthStartDateSession)}-${pad(day.dayStartDateSession)}`;
    const endYear = day.monthEndDateSession < day.monthStartDateSession ? Number(year) + 1 : year;
    const end = `${endYear}-${pad(day.monthEndDateSession)}-${pad(day.dayEndDateSession)}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return;
    sessions.set(start, { start: start, end: end, location: null });
  });

  return [...sessions.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function parseLocation(xml) {
  const doc = parseXML(xml);
  const localities = findAll(doc, 'hasLocality');
  for (const node of localities) {
    const resource = node.attributes['rdf:resource'] || node.attributes.resource || '';
    if (resource.endsWith('/FRA_SXB')) return 'Strasbourg';
    if (resource.endsWith('/BEL_BRU')) return 'Brussels';
  }
  return null;
}

/* Every sitting day covered by a session, so the importer can ask "did they
   sit that day" without fetching anything. */
export function sittingDays(sessions) {
  const days = [];
  sessions.forEach(function (session) {
    const from = new Date(session.start + 'T00:00:00Z');
    const to = new Date(session.end + 'T00:00:00Z');
    for (let day = from; day <= to; day = new Date(day.getTime() + 86400000)) {
      days.push(day.toISOString().slice(0, 10));
    }
  });
  return days;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const term = Number(args.term || TERM);

  const payload = args.file
    ? await readFile(String(args.file), 'utf8')
    : await get(CALENDAR_URL(term), 'application/json');
  if (!payload) throw new Error('The session calendar could not be fetched.');

  const sessions = parseCalendar(payload);
  if (!sessions.length) {
    throw new Error('The calendar parsed to no sessions — the response shape may have changed.');
  }

  if (!args['no-locations'] && !args.file) {
    // Only sessions we do not already know about, so a re-run is cheap.
    let known = {};
    try {
      const previous = JSON.parse(await readFile(path.join(ROOT, OUT), 'utf8'));
      previous.sessions.forEach(function (session) { known[session.start] = session.location; });
    } catch (error) {
      known = {};
    }

    for (const session of sessions) {
      if (known[session.start]) {
        session.location = known[session.start];
        continue;
      }
      try {
        const xml = await get(MEETING_URL(session.start), 'application/rdf+xml,application/xml');
        session.location = xml ? parseLocation(xml) : null;
      } catch (error) {
        session.location = null;
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const past = sessions.filter((session) => session.end < today);
  const upcoming = sessions.filter((session) => session.end >= today);

  await writeFile(path.join(ROOT, OUT), JSON.stringify({
    metadata: {
      term: term,
      fetched: today,
      source: CALENDAR_URL(term),
      locationSource: 'https://data.europarl.europa.eu/api/v1/meetings/MTG-PL-{date}',
      note: 'One entry per plenary session. Locations come from the meeting record; ' +
        'a null location means the record did not name one.'
    },
    sessions: sessions
  }, null, 2) + '\n', 'utf8');

  const strasbourg = past.filter((session) => session.location === 'Strasbourg');
  console.log(`${OUT} — ${sessions.length} sessions, ${past.length} past, ${upcoming.length} upcoming`);
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
