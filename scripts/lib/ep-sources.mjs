/* Where one vote can be checked, at the Parliament's own address.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Every record used to cite data.europarl.europa.eu — the front door, with
 * nothing behind it for this vote — or, at best, the JSON of a whole sitting.
 * Neither is a citation a reader can follow.
 *
 * These three are. Each shape was tried against the Parliament's own servers
 * across five sittings spanning the term, in a real browser, and each answered
 * with a real page: see scripts/probe-vote-links.mjs and the workflow that
 * runs it. Shapes that looked plausible and turned out not to exist — a
 * per-decision endpoint on the portal, an ELI identifier for a decision — were
 * found that way and are not used. Neither is the roll-call annex as XML,
 * which fails on four sittings out of five.
 */

/* The parliamentary term, which is part of every minutes address. The tenth
   began on 16 July 2024, and the ninth ran from 2019. A record from before
   this project's window would still be numbered correctly. */
export function termOf(date) {
  if (date >= '2024-07-16') return 10;
  if (date >= '2019-07-02') return 9;
  return 8;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function spoken(date) {
  const parts = String(date).split('-');
  if (parts.length !== 3) return date;
  return Number(parts[2]) + ' ' + MONTHS[Number(parts[1]) - 1] + ' ' + parts[0];
}

/* A procedure reference carries a slash — 2023/0212(COD) — and the slash
   belongs in the address. Encoding it breaks the lookup on OEIL's side. */
export function procedureUrl(reference) {
  if (!reference) return null;
  return 'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=' +
    encodeURIComponent(reference).replace(/%2F/g, '/');
}

export function sourcesFor(date, procedureReference) {
  const term = termOf(date);
  const doceo = 'https://www.europarl.europa.eu/doceo/document/PV-' + term + '-' + date;

  const sources = [
    {
      // The document this vote is actually recorded in: the Parliament's own
      // list of who voted which way at that sitting.
      label: 'Roll-call results, ' + spoken(date),
      url: doceo + '-RCV_EN.html',
      role: 'record'
    },
    {
      label: 'Minutes of the sitting',
      url: doceo + '-TOC_EN.html',
      role: 'minutes'
    }
  ];

  if (procedureReference) {
    sources.push({
      label: 'Procedure file ' + procedureReference,
      url: procedureUrl(procedureReference),
      role: 'procedure'
    });
  }

  sources.push({
    // What this project read, rather than what a reader would read: the same
    // sitting as machine-readable data, so the numbers here can be recounted.
    label: 'Open data record for the sitting',
    url: 'https://data.europarl.europa.eu/api/v2/meetings/MTG-PL-' + date +
      '/decisions?format=application%2Fld%2Bjson',
    role: 'data'
  });

  return sources;
}
