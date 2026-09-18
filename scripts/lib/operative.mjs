/* What a resolution actually asks for, in the Parliament's own words.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A motion for a resolution is built of numbered operative paragraphs, each
 * beginning with a verb the Parliament uses deliberately: "Calls on Member
 * States to maintain their ports open to NGO vessels;". Three of those under a
 * vote say what it was about in a way a reader can check word for word against
 * the document they are quoted from.
 *
 * Nothing here writes, paraphrases or condenses a sentence. It selects whole
 * paragraphs and takes off their number and their closing semicolon. If the
 * document has no operative paragraphs — a legislative consent has none, it
 * approves a text rather than asking for anything — it yields nothing, and the
 * vote goes without rather than with something invented for it.
 */

/* The verbs, strongest first. A resolution opens on throat-clearing —
   "Welcomes the Commission proposal", "Notes that" — and buries the demand
   at paragraph 9. Ranking by the verb rather than by position puts what the
   Parliament asks for above what it observes, and it is a rule anybody can
   apply to the same document and get the same three back. */
const DEMANDS = ['Calls on', 'Urges', 'Demands', 'Requests', 'Insists', 'Instructs'];
const POSITIONS = ['Condemns', 'Deplores', 'Regrets', 'Welcomes', 'Supports', 'Rejects'];
const OBSERVATIONS = ['Stresses', 'Underlines', 'Emphasises', 'Notes', 'Recalls',
  'Considers', 'Points out', 'Takes note', 'Reiterates', 'Believes'];

const ALL = [].concat(DEMANDS, POSITIONS, OBSERVATIONS);
const OPENS = new RegExp('^(\\d{1,3})\\.\\s+(' + ALL.join('|') + ')\\b', 'i');

function rank(text) {
  const verb = (OPENS.exec(text) || [])[2] || '';
  const found = function (list) {
    return list.some(function (word) { return word.toLowerCase() === verb.toLowerCase(); });
  };
  if (found(DEMANDS)) return 0;
  if (found(POSITIONS)) return 1;
  return 2;
}

/* A bullet has to be readable at a glance, so a paragraph running to a
   half-page of conditions is not one. The Parliament writes plenty of those
   and they are left where they are, in the document. */
const SHORTEST = 45;
const LONGEST = 230;

export function operativeParagraphs(text) {
  const lines = String(text || '').split('\n');
  const found = [];
  const seen = new Set();
  lines.forEach(function (line) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (trimmed.length < SHORTEST || trimmed.length > LONGEST) return;
    if (!OPENS.test(trimmed)) return;
    const number = Number((OPENS.exec(trimmed) || [])[1]);
    // Strip the paragraph number and the semicolon that ends it.
    const body = trimmed.replace(/^\d{1,3}\.\s+/, '').replace(/\s*[;,.]\s*$/, '').trim();
    if (!body || seen.has(body)) return;
    seen.add(body);
    found.push({ text: body, order: number, rank: rank(trimmed) });
  });
  return found;
}

export function bulletsFrom(text, howMany) {
  const wanted = howMany || 3;
  return operativeParagraphs(text)
    .sort(function (a, b) { return a.rank - b.rank || a.order - b.order; })
    .slice(0, wanted)
    .map(function (item) { return item.text; });
}
