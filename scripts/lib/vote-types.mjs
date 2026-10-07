/* What was put to the vote, in plain English.

   A card shows a text's title and the result of one roll-call on it. Most of
   the time that roll-call is on the text as a whole and the result is the
   text's. Not always:

   - a motion to reject a law, rejected, is the law surviving — but the card
     said "Rejected" under the law's title;
   - where the House held no roll-call on a text as a whole, the record is the
     last roll-call it did hold, which can be one amendment or one paragraph;
   - requests to refer a text back, to adjourn, to vote on amendments, are
     decisions about the procedure, not about the text.

   The Parliament says which in the vote's label, but in three languages and a
   dozen spellings — "Proposition de rejet", "Proposal for rejection (Rule
   67(1))", "Accord provisoire - Am 69", "Am 10", "§ 20/2". This reads them
   into one vocabulary. It only names what the label says; a label it does not
   recognise gets no type rather than a guess.

   SPDX-License-Identifier: AGPL-3.0-or-later
*/

// Order matters: the first that matches wins, so the specific comes before
// the general ("Commission proposal and amendments" is the proposal).
const SPECIFIC = [
  ['Motion to reject', /\bproposition de rejet\b|\bproposal for rejection\b|\bmotion to reject\b|\brejection of the council'?s position\b/i],
  ['Provisional agreement', /\baccord provisoire\b|\bprovisional agreement\b/i],
  ['Mandate for negotiations', /\binterinstitutional negotiations\b|\bnégociations interinstitutionnelles\b/i],
  ['Referral back to committee', /\breferr?al\b|\bdemande de renvoi\b/i],
  ['Request to vote on amendments', /\bvote on (?:the )?amendments\b|\bmettre aux voix les amendements\b/i],
  ['Adjournment request', /\badjournment\b|\bajournement\b|\bpostponement of the vote\b/i],
  ['Urgent procedure request', /\burgent (?:procedure|decision)\b|\bdécision d'urgence\b/i],
  ['Inadmissibility motion', /\binadmissible\b/i],
  ['Agenda request', /^(?:antrag der|request (?:from|by) |demande du groupe)/i],
  ['Commission proposal', /\bproposition de la commission\b|\bcommiss?ion proposal\b/i],
  ['Joint text', /\bprojet commun\b|\bjoint (?:text|proposal)\b/i],
  ['Draft Council act', /\bprojet (?:de (?:décision|règlement) )?du conseil\b|\bdraft council\b|\bproposal for a council\b|\bcouncil draft\b/i]
];

// Words that also turn up in the titles of texts ("dispute resolution",
// "single vote"), so they are read only where the label says what was voted:
// its last part.
const GENERAL = [
  ['Consent', /\bconsent\b|\bapproval procedure\b|\bprocédure d'approbation\b/i],
  ['Single vote', /\bsingle vote\b|\bvote unique\b|\bvote final\b|\bfinal vote\b/i],
  ['Proposal for a decision', /\bproposals? for (?:a )?decisions?\b|\bproposition de décision\b|\bmotion for a decision\b|\brecommendation for a decision\b|\bdraft decision\b|^decision\b/i],
  ['Recommendation', /\brecomm[ae]nd(?:ation)?\b/i],
  ['Motion for a resolution', /\bresolution\b|\brésolution\b/i]
];

// What the last part of a label says when the roll-call was on a piece of the
// text: "A9-0161/2023 – Jan Huitema – Am 10", "B9-0239/2019 – § 11/2".
const AMENDMENT = /^(?:ams?\b|am\s*\d|am\/|amendments?\s+\d)/i;
const PART = /^(?:§|after §|title before|paragraph\b|recital\b|consid(?:é|e)rant\b|visa\b|citation\b|point\b|annex\b|article\b|block\b|bloc\b|vote en bloc\b|original text\b|directive\b.*\barticle\b)/i;

// The parts of a label: "A9-0228/2020 - Ondřej Kovařík - Provisional
// Agreement - Am 2". A hyphen inside a name has no space beside it.
const SPLIT = /\s*[–—-]\s+|\s+[–—-]\s*/;

/* The part of a record that names what was voted: what scripts/
   tidy-summaries.mjs moved out of the summary, else the label at the end of
   the subtitle. */
export function voteLabel(record) {
  if (record.votedOn) return String(record.votedOn);
  return String(record.subtitle || '').replace(/\s*—\s*vote in plenary\s*$/, '').trim();
}

// A change to the agenda is named in the title, not the label: "Thursday's
// agenda – Request by The Left Group", "Ordre du jour de mercredi – Demande
// des groupes S&D et Renew". Both halves are needed, so "the 2030 Agenda" is
// not one.
const AGENDA_TITLE = /\b(?:agenda|ordre du jour|tagesordnung)\b.*\b(?:request|demande|antrag)/i;

export function voteType(record) {
  if (AGENDA_TITLE.test(String(record.title || ''))) return 'Agenda request';
  const label = voteLabel(record);
  if (!label) return null;
  const parts = label.split(SPLIT).map(function (part) { return part.trim(); }).filter(Boolean);
  const last = parts[parts.length - 1] || '';

  for (const [name, pattern] of SPECIFIC.concat(GENERAL)) {
    if (pattern.test(last)) return name;
  }
  const piece = AMENDMENT.test(last) ? 'Amendment' : PART.test(last) ? 'Part of the text' : null;
  if (piece) {
    // "Provisional agreement – Am 2": the agreement is tabled as an
    // amendment, and the vote is on the agreement. The same for a motion to
    // reject.
    const before = parts[parts.length - 2] || '';
    for (const [name, pattern] of SPECIFIC) {
      if (pattern.test(before)) return name;
    }
    return piece;
  }
  // "C10-0119/2024 – Provisional agreement (Commission proposal – unamended)":
  // the type is not always last. Only the unambiguous ones are looked for in
  // the rest of the label.
  for (const [name, pattern] of SPECIFIC) {
    if (pattern.test(label)) return name;
  }
  return null;
}

/* The types whose result is not the text's own fate. On a card these are
   always named, because "Rejected" under a law's title means something else
   when what was rejected was a motion to throw the law out. */
export const NOT_THE_TEXT = new Set([
  'Motion to reject',
  'Amendment',
  'Part of the text',
  'Mandate for negotiations',
  'Referral back to committee',
  'Request to vote on amendments',
  'Adjournment request',
  'Urgent procedure request',
  'Inadmissibility motion',
  'Agenda request'
]);

/* What the result means, for each of those. Said once under the result on
   the vote's page and on its share page. Each is true of the type by
   definition; none says what happened to the text afterwards, which a record
   of one roll-call does not hold. build-index.mjs carries these to the page. */
export const MEANING = {
  'Motion to reject': 'This was a vote on a motion to reject the text. “Rejected” means ' +
    'the motion failed and the text was not thrown out; “Adopted” means the House ' +
    'rejected the text.',
  'Amendment': 'This was a vote on one amendment to the text, not on the text as a whole.',
  'Part of the text': 'This was a vote on one part of the text — a paragraph, a recital or ' +
    'a block of them — not on the text as a whole.',
  'Referral back to committee': 'This was a vote on sending the text back to committee, ' +
    'not on the text itself.',
  'Request to vote on amendments': 'This was a vote on whether to put amendments to the ' +
    'text to the vote, not on the text itself.',
  'Adjournment request': 'This was a vote on postponing the vote, not on the text itself.',
  'Urgent procedure request': 'This was a vote on whether to deal with the text by urgent ' +
    'procedure, not on the text itself.',
  'Mandate for negotiations': 'This was a vote on opening negotiations with the Council, ' +
    'not on a final text.',
  'Inadmissibility motion': 'This was a vote on declaring the matter inadmissible.',
  'Agenda request': 'This was a vote on a political group’s request to change the agenda.'
};
