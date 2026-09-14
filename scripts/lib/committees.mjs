/* The committee that wrote a report, and what to call it.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Which committee is data: it is on the document, as creator, in the
 * Parliament's own record — EP_ENVI, org/INTA. What is not data is the name.
 * Asked for ENVI, /corporate-bodies/ENVI answers "ENVI"; the portal keeps the
 * acronym and nothing longer, and it publishes no vocabulary at all — every
 * spelling of a concept endpoint answers 404, which is why the EuroVoc subject
 * a document carries cannot be turned into "Gender equality" here.
 *
 * So the expansion below is a caption, not a fact fetched from anywhere: the
 * Parliament's standing committees under the names it uses for them. A code
 * that is not in this list is shown as the code, never as a guess.
 */

/* Two names each: the Parliament's own, and one short enough to sit on a card.
   A chip reading "Environment, Public Health and Food Safety" is a sentence,
   and a column of those is unreadable at a glance, which defeats the point of
   a chip. The short form is the committee's subject in the fewest words that
   stay true to it; the full name is what a reader sees on hovering. */
const COMMITTEES = {
  AFET: ['Foreign Affairs', 'Foreign Affairs'],
  DROI: ['Human Rights', 'Human Rights'],
  SEDE: ['Security and Defence', 'Security and Defence'],
  DEVE: ['Development', 'Development'],
  INTA: ['International Trade', 'Trade'],
  BUDG: ['Budgets', 'Budgets'],
  CONT: ['Budgetary Control', 'Budget Control'],
  ECON: ['Economic and Monetary Affairs', 'Economy'],
  FISC: ['Tax Matters', 'Tax'],
  EMPL: ['Employment and Social Affairs', 'Employment'],
  ENVI: ['Environment, Public Health and Food Safety', 'Environment'],
  SANT: ['Public Health', 'Public Health'],
  ITRE: ['Industry, Research and Energy', 'Industry and Energy'],
  IMCO: ['Internal Market and Consumer Protection', 'Single Market'],
  TRAN: ['Transport and Tourism', 'Transport'],
  REGI: ['Regional Development', 'Regional Development'],
  AGRI: ['Agriculture and Rural Development', 'Agriculture'],
  PECH: ['Fisheries', 'Fisheries'],
  CULT: ['Culture and Education', 'Culture and Education'],
  JURI: ['Legal Affairs', 'Legal Affairs'],
  LIBE: ['Civil Liberties, Justice and Home Affairs', 'Civil Liberties'],
  AFCO: ['Constitutional Affairs', 'Constitutional Affairs'],
  FEMM: ["Women's Rights and Gender Equality", 'Gender Equality'],
  PETI: ['Petitions', 'Petitions'],
  EMIS: ['Emission Measurements in the Automotive Sector', 'Car Emissions'],
  INGE: ['Foreign Interference in Democratic Processes', 'Foreign Interference'],
  ANIT: ['Protection of Animals during Transport', 'Animal Transport'],
  BECA: ['Beating Cancer', 'Cancer'],
  AIDA: ['Artificial Intelligence in a Digital Age', 'Artificial Intelligence'],
  COVI: ['the COVID-19 Pandemic', 'COVID-19'],
  PEGA: ['Pegasus and Equivalent Surveillance Spyware', 'Spyware'],
  EUDS: ['the European Democracy Shield', 'Democracy Shield'],
  HOUS: ['the Housing Crisis', 'Housing'],
  CODE: ['Conciliation', 'Conciliation']
};

/* A political group is also a creator of texts, and is not a committee. The
   codes collide in shape — three to five capitals — so the guard is the list
   above, not the pattern. A first version of this took PPE for a committee. */
function entry(code) {
  return COMMITTEES[String(code || '').trim().toUpperCase().replace(/^EP_/, '')] || null;
}

export function committeeName(code) {
  const found = entry(code);
  return found ? found[0] : null;
}

/* The chip's words. Falls back to the full name, never to a guess. */
export function committeeShort(code) {
  const found = entry(code);
  return found ? (found[1] || found[0]) : null;
}

export function isCommittee(code) {
  return Boolean(committeeName(code));
}

/* The committee among a document's creators, if one of them is a committee.
   The other creators are people — the rapporteur — and political groups. */
export function committeeOf(creator) {
  for (const entry of [].concat(creator || [])) {
    const text = String(typeof entry === 'string' ? entry : (entry && entry.id) || '');
    if (!text || /person\//i.test(text)) continue;
    const code = text.split('/').pop().replace(/^EP_/, '').toUpperCase();
    if (isCommittee(code)) return code;
  }
  return null;
}
