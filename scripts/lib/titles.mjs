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
  if (NOT_ENGLISH.test(value)) return false;
  // Two words or fewer: no grammar to judge, so accept it rather than throw
  // away a perfectly good "InvestEU".
  if (value.split(/\s+/).length <= 2) return true;
  return ENGLISH.test(value);
}

/* The wrapper a formal title carries before it says anything. Each of these is
   the Parliament's own boilerplate, repeated identically across hundreds of
   documents, and what follows it is the subject. */
const WRAPPERS = [
  /^(?:draft\s+)?report\s+on\s+the\s+proposal\s+for\s+a[n]?\s+[a-z ]*?of\s+the\s+european\s+parliament\s+and\s+of\s+the\s+council\s+(?:on|amending|establishing|laying down|as regards)\s+/i,
  // "…on the conclusion, on behalf of the Union, of the Free Trade Agreement
  // between…" — everything up to that last "of" is the machinery of ratifying
  // a treaty, and the treaty is what the vote was about.
  /^(?:draft\s+)?recommendation\s+on\s+the\s+draft\s+council\s+decision\s+on\s+the\s+(?:conclusion|signing|ratification|renewal)(?:\s*,?\s*on\s+behalf\s+of\s+the\s+(?:european\s+)?union(?:\s+and\s+its\s+member\s+states)?)?\s*,?\s*of\s+/i,
  /^(?:draft\s+)?report\s+on\s+the\s+proposal\s+for\s+a[n]?\s+/i,
  /^(?:draft\s+)?recommendation\s+on\s+the\s+draft\s+council\s+decision\s+/i,
  /^motion\s+for\s+a\s+resolution\s+on\s+/i,
  /^(?:draft\s+)?report\s+on\s+/i,
  /^(?:draft\s+)?recommendation\s+on\s+/i,
  /^proposal\s+for\s+a[n]?\s+[a-z ]*?of\s+the\s+european\s+parliament\s+and\s+of\s+the\s+council\s+(?:on|amending|establishing)\s+/i
];

/* A clause the Parliament appends to nearly every legislative title, naming
   what the act repeals or amends. True, and never the reason anyone is
   reading. */
const TAIL = /\s*(?:\(codification\)|\(recast\)|\(codified text\))\s*$/i;

export function shorten(title) {
  let text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  for (const wrapper of WRAPPERS) {
    const trimmed = text.replace(wrapper, '');
    if (trimmed !== text && trimmed.length > 12) {
      text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      break;
    }
  }
  text = text.replace(TAIL, '').trim();

  /* A title that is still a paragraph gets cut at the last sentence boundary
     that leaves something readable — a semicolon or a dash, where the
     Parliament has listed several things — rather than mid-word with an
     ellipsis, which reads as a bug. */
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
