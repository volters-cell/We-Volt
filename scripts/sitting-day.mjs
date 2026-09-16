#!/usr/bin/env node
/*
 * Is the Parliament sitting today?
 *
 *   node scripts/sitting-day.mjs              -> prints yes or no
 *   node scripts/sitting-day.mjs --date 2026-09-16
 *
 * The sync used to run at fixed hours on Monday to Thursday, which is a guess
 * at when the Parliament sits. It is a good guess and it is wrong: of the 39
 * sessions the Parliament has published, 29 run Monday to Thursday, five run
 * Wednesday to Thursday, four are a single day, and one runs Tuesday to
 * Friday. A Friday sitting is invisible to a Monday-to-Thursday schedule.
 *
 * The calendar is already in this repository, fetched from the portal and
 * refreshed weekly, so the schedule can read it instead of guessing. This
 * answers the one question a scheduled run needs to ask.
 *
 * The day after a session ends counts as sitting, because the portal fills in
 * a sitting's details — among them whether a text carried — over the following
 * day, and a run that stops at the last sitting day leaves the site showing
 * results this project derived rather than the Parliament's own.
 *
 * When the answer cannot be known — no calendar, a calendar that will not
 * parse, or one whose last session has already ended and which is therefore
 * out of date — the answer is yes. Importing on a quiet day costs a minute and
 * writes nothing. Missing a sitting is the failure that matters.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CALENDAR = 'data/reference/plenary-calendar.json';

export function dayAfter(date) {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

export function sittingOn(date, sessions) {
  if (!Array.isArray(sessions) || !sessions.length) return { sitting: true, why: 'no calendar to read' };

  const ends = sessions.map((s) => s.end || s.start).filter(Boolean).sort();
  const last = ends[ends.length - 1];
  if (last < date) return { sitting: true, why: `calendar ends ${last}, before ${date}` };

  for (const session of sessions) {
    const start = session.start;
    const end = dayAfter(session.end || session.start);
    if (start && date >= start && date <= end) {
      const where = session.location || 'the Parliament';
      return {
        sitting: true,
        why: date > (session.end || session.start)
          ? `the day after the ${where} session of ${start}`
          : `the ${where} session of ${start} to ${session.end || session.start}`
      };
    }
  }
  return { sitting: false, why: `no session covers ${date}` };
}

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1];
}

if (process.argv[1] && process.argv[1].endsWith('sitting-day.mjs')) {
  const date = arg('date') || new Date().toISOString().slice(0, 10);
  let sessions = null;
  try {
    sessions = JSON.parse(await readFile(path.join(ROOT, CALENDAR), 'utf8')).sessions;
  } catch (error) {
    sessions = null;
  }
  const answer = sittingOn(date, sessions);
  console.log(answer.sitting ? 'yes' : 'no');
  console.error(`${date}: ${answer.why}`);
}
