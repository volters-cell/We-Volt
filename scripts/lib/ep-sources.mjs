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

/* Which references OEIL will actually answer for.

   Asked, not assumed — scripts/probe-reference-links.mjs opened one of each
   shape in a browser and read what came back:

     2024/2721(RSP)    200, Procedure File: 2024/2721(RSP)
     2023/0212(COD)    200, Procedure File: 2023/0212(COD)
     A9-0002/2020      200, Procedure File: 2018/0358(NLE)   — resolves it
     C9-0161/2020      200, Procedure File: 2020/0113(COD)   — resolves it
     2019/0806         404, Error 404 | Legislative Observatory
     2019/2057         404
     RC-B9-0006/2019   404

   So a procedure number without its type in brackets is not a reference OEIL
   knows, and neither is a joint motion. Between them that was 1,715 of the
   3,188 links this site published — 54% of its "check it at the European
   Parliament" invitations answering Error 404. A citation that opens nothing
   is worse than none: it invites the check and then fails it. */
const FULL_PROCEDURE = /^\d{4}\/\d{4}[A-Z]?\([A-Z]+\)$/;
const DOCUMENT_CODE = /^[A-Z]{1,3}\d{1,2}-\d{4}\/\d{4}$/;

export function opensOnOeil(reference) {
  const ref = String(reference || '').trim();
  if (!ref) return false;
  if (FULL_PROCEDURE.test(ref)) return true;
  // A joint motion carries a document code and OEIL has nothing for it.
  if (/^RC-/i.test(ref)) return false;
  return DOCUMENT_CODE.test(ref);
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

  /* Only where the Parliament will answer for it. A vote whose reference OEIL
     does not know keeps the three links that do work — the roll-call annex,
     the minutes, and the sitting as data — rather than gaining a fourth that
     opens an error page. */
  if (procedureReference && opensOnOeil(procedureReference)) {
    sources.push({
      // The reference is named only when it is a procedure reference. A
      // document code resolves to a procedure file that is not called that,
      // so naming it would promise the wrong page.
      label: FULL_PROCEDURE.test(String(procedureReference).trim())
        ? 'Procedure file ' + procedureReference
        : 'Procedure file for ' + procedureReference,
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

/* A vote on part of a text, rather than on the text.

   The Parliament writes one by appending the part to the title:

     A9-0001/2021 - Gilles Lebreton - § 22/1
     A9-0379/2023 – Robert Hajšel – Recital K/2
     B9-0499/2023 – § 13/6

   so the marker is the tail, after the last dash. Matching anywhere in the
   words instead would throw away real votes: "Ongoing hearings under Article
   7(1) TEU regarding Hungary" and "Objection pursuant to Rule 111(3):
   Deleting Gibraltar from the table in Point I" are both votes on a whole
   text whose subject happens to name an article and a point. Both were
   dropped by a looser rule before this one was written.

   Why it matters: the tenth term's decisions carry decisionAboutId, which the
   importer already reads, so amendments and splits are marked there and never
   reach the site. The ninth term's do not — the split is only in the title —
   so 5,196 of its 7,558 imported records were paragraph votes. The same
   Parliament, the same site, two different meanings of "a vote". */
const PART_OF_A_TEXT = new RegExp([
  '^§',
  // "am § 43/2" as well as "am 12": the Parliament writes the amendment
  // marker before a paragraph sign as readily as before a number.
  '^am(?:s|endements?|endments?)?\\s*[§\\d]',
  '^(?:consid(?:é|e)rant|recital)\\b',
  '^(?:visa|citation)\\s*\\d',
  // "Article 4, § 3/2" and "Article 10, § 5" are parts; "Article 7 procedure
  // on Hungary" is a subject. The comma or slash is what separates them, so a
  // bare article number ends the tail or is followed by one.
  '^(?:article|art\\.)\\s*\\d+\\s*(?:[,/].*)?$',
  '^(?:annexe|annex)\\b[\\s,]*(?:part(?:ie)?\\s*)?[ivx0-9]',
  '^(?:partie|part)\\s+[ivx0-9]',
  '^point\\s+[a-z0-9]+\\s*(?:/\\d+)?$',
  '^[a-z]?\\d+\\s*/\\s*\\d+$'
].join('|'), 'i');

/* The Parliament stamps most of its ninth-term labels with the moment the vote
   was taken — "09/03/2021 16:47:58.618" — and a few with the date alone. Every
   pattern above that ends the tail would fail against it, which is not a small
   matter: on 9 March 2021 it hid all eleven part votes of the sitting behind
   an anchor that could never match, and they were imported as whole texts. */
export const STAMPED = /\s+\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)?\s*$/;

export function isPartOfAText(title) {
  const tail = String(title || '').replace(STAMPED, '').split(/\s[–—-]\s/).pop().trim();
  return PART_OF_A_TEXT.test(tail);
}
