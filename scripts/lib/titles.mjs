/* A vote's title, in English and short enough to read in a list.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The Parliament writes a title three ways and this site inherits all three.
 * The vote item gives a short name — "Global role of the euro" — and often
 * gives it only in French. The document gives a formal one — "REPORT on the
 * proposal for a regulation of the European Parliament and of the Council
 * amending…" — which is usually in English and sometimes 695 characters long.
 * The decision gives a filing code and the time of day.
 *
 * Nothing here translates anything or invents a name. It chooses between what
 * the Parliament published, and it removes the parts of a formal title that
 * are procedure rather than subject — the wrapper every report of that kind
 * carries, identical across hundreds of them, which tells a reader nothing
 * about this one.
 */

/* Enough English to serve as an English title. A short label of one or two
   words — "InvestEU", "Erasmus+" — has no grammar to test, so the test is for
   words that only English uses, and the absence of words only French and
   German use. It is a heuristic and it is used only to choose between two
   published titles, never to change one. */
const ENGLISH = /\b(the|of|on|and|for|to|in|with|from|by|as|its|European Union)\b/i;
const NOT_ENGLISH = /\b(de la|du|des|les|le|la|aux|pour|sur|dans|par|une|et|en|ainsi|afin|concernant|relatif|projet|décharge|règlement|accord|rapport|résolution|mise en œuvre|der|die|das|und|für|über|von|zur|Antrag|Fraktion)\b/i;

export function looksEnglish(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  // "(" is a title the Parliament published and it is not English, or any
  // other language. Anything with no word in it has to be looked up again.
  if (!/[\p{L}]{3}/u.test(value)) return false;
  if (NOT_ENGLISH.test(value)) return false;
  // Two words or fewer: no grammar to judge, so accept it rather than throw
  // away a perfectly good "InvestEU".
  if (value.split(/\s+/).length <= 2) return true;
  return ENGLISH.test(value);
}

/* The Parliament sometimes publishes one title in three languages at once,
   joined by dashes: "Modification du règlement (UE) nº 575/2013 … - Amending
   Regulation (EU) No 575/2013 … - Änderung der Verordnung (EU) Nr. 575/2013 …".
   All three say the same thing and one of them is English, so the English one
   is the title and the other two are a copy of it in a language this site is
   not written in.

   The languages are joined with a plain hyphen; a dash inside one of them is
   the Parliament separating a subject from its subtitle — "Electric aviation
   – a solution for short- and mid-range flights" is one title, not two — so
   only the hyphen splits.

   Only halves long enough to be a title count, because the same dash also
   separates a filing code from its rapporteur — "A9-0002/2020 - Geert
   Bourgeois - Consent procedure" — and "Consent procedure" is English and is
   not what the vote was about. And only when exactly one of them is English,
   so nothing is chosen where the test cannot tell. */
export function englishHalf(title) {
  const halves = String(title || '').split(/\s+-\s+/)
    .map(function (half) { return half.trim(); })
    .filter(function (half) { return half.length >= 40; });
  if (halves.length < 2) return '';
  const english = halves.filter(looksEnglish);
  return english.length === 1 ? english[0] : '';
}

/* The wrapper a formal title carries before it says anything. Each of these is
   the Parliament's own boilerplate, repeated identically across hundreds of
   documents, and what follows it is the subject. */
const WRAPPERS = [
  /^(?:draft\s+)?report\s+on\s+the\s+proposal\s+for\s+an?\s+[a-z ]*?\bof\s+the\s+european\s+parliament\s+and\s+of\s+the\s+council\s+(?=\b(?:on|amending|establishing|laying\s+down|as\s+regards)\b)/i,
  // "…on the conclusion, on behalf of the Union, of the Free Trade Agreement
  // between…" — everything up to that last "of" is the machinery of ratifying
  // a treaty, and the treaty is what the vote was about.
  /^(?:draft\s+)?recommendation\s+on\s+the\s+draft\s+council\s+decision\s+on\s+the\s+(?:conclusion|signing|ratification|renewal)(?:\s*,?\s*on\s+behalf\s+of\s+the\s+(?:european\s+)?union(?:\s+and\s+its\s+member\s+states)?)?\s*,?\s*of\s+/i,
  /^(?:draft\s+)?report\s+on\s+the\s+proposal\s+for\s+a[n]?\s+/i,
  /^(?:draft\s+)?recommendation\s+on\s+the\s+draft\s+council\s+decision\s+/i,
  /^motion\s+for\s+a\s+resolution\s+on\s+/i,
  /^(?:draft\s+)?report\s+on\s+/i,
  /^(?:draft\s+)?recommendation\s+on\s+/i,
  /^proposal\s+for\s+an?\s+[a-z ]*?\bof\s+the\s+european\s+parliament\s+and\s+of\s+the\s+council\s+(?=\b(?:on|amending|establishing)\b)/i,
  // "RECOMMENDATION FOR SECOND READING on the Council position at first
  // reading with a view to the adoption of a regulation of the European
  // Parliament and of the Council amending…" — 130 characters of reading
  // stages before the subject is named.
  /^recommendation\s+for\s+second\s+reading\s+on\s+the\s+council\s+position(?:\s+at\s+first\s+reading)?\s+with\s+a\s+view\s+to\s+the\s+adoption\s+of\s+an?\s+[a-z ]*?\b(?:of\s+the\s+european\s+parliament\s+and\s+of\s+the\s+council\s+)?(?=\b(?:on|amending|establishing|laying\s+down|as\s+regards)\b)/i
];

/* The rule a motion is tabled under is procedure and the objection is the
   subject: "Objection pursuant to Rule 112(2) and (3): Genetically modified
   maize MZIR098" is about the maize, and every one of the ninety-odd
   objections cites a rule number no reader is looking for. The word
   "Objection" stays, because that is what the vote was. */
const RULE = /^objection\s+pursuant\s+to\s+rule\s+[\d()\sand,;.\/c-]*?:\s*/i;

/* A title that opens with the bare name of a law is one an earlier version of
   this shortening damaged: it removed "amending" along with the wrapper in
   front of it, and left the card claiming to be the regulation rather than the
   vote that changed it. The verb is not recoverable from what is left, so such
   a title is read again from the document. */
const VERB_STRIPPED =
  /^(?:council\s+|commission\s+)?(?:regulation|directive|decision|recommendation)\b\s*(?:\((?:EU|EC|EEC|Euratom)[^)]*\)|No\b|\(\w+\))/i;

export function looksVerbStripped(title) {
  return VERB_STRIPPED.test(String(title || '').trim());
}

/* A clause the Parliament appends to nearly every legislative title, naming
   what the act repeals or amends. True, and never the reason anyone is
   reading. */
const TAIL = /\s*(?:\(codification\)|\(recast\)|\(codified text\))\s*$/i;

export function shorten(title) {
  let text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  for (const wrapper of WRAPPERS) {
    /* The verb the wrapper ends on is kept, because it is the difference
       between a vote and the law it acts on: "Amending Regulation (EU)
       2017/2107 laying down…" is what happened, and "Regulation (EU)
       2017/2107 laying down…" reads as though the card were the regulation
       itself. Only a bare "on" goes, which carries nothing once the report it
       belonged to has been removed. */
    const trimmed = text.replace(wrapper, '').replace(/^on\s+/i, '');
    if (trimmed !== text && trimmed.length > 12) {
      text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      break;
    }
  }
  text = text.replace(RULE, function () { return 'Objection: '; });
  text = text.replace(TAIL, '').trim();

  /* A title that is still a paragraph is usually the Parliament listing
     several things at once, separated by semicolons. The first of them is the
     one the title leads with; the rest can be read on the vote's own page. Cut
     at the first separator past the fortieth character, so the result is a
     whole clause rather than a word cut in half. */
  if (text.length > 120) {
    const at = [text.indexOf('; ', 40), text.indexOf(' — ', 40), text.indexOf(' – ', 40)]
      .filter(function (where) { return where > 40; });
    if (at.length) text = text.slice(0, Math.min.apply(null, at)).trim();
  }
  return text.replace(/[\s,;:–—-]+$/, '').trim();
}
