#!/usr/bin/env node
/*
 * Are the French titles the Parliament's only answer, or this project's?
 *
 * 510 of 3,570 votes are titled in French and eight in German — "Conclusion de
 * l'accord de libre-échange entre l'Union européenne et le Viêt Nam" on a site
 * written in English. The importer asks for English first and falls back
 * through mul and fr to whatever the portal has, so either English was never
 * published for these, or it is published somewhere this project does not
 * look.
 *
 * And length. The median title is 73 characters and the longest is 695 — a
 * document's formal name, "REPORT on the proposal for a regulation of the
 * European Parliament and of the Council amending…". HowTheyVote shows "Global
 * role of the euro" for the same kind of vote, and a list of those can be read
 * at a glance where a list of ours cannot.
 *
 * So this asks, for sittings that produced French titles: which languages the
 * vote item offers, which the decision offers, and what the document holds —
 * title_dcterms, and whether it too is a language map with English in it.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, lastSegment, isRollCall } from './lib/portal.mjs';
import { documentCode } from './fetch-plenary.mjs';

const DAY = '2020-02-12';
const WANTED = ['112321', '112339', '112371'];

const decisions = (await getAll(`/meetings/MTG-PL-${DAY}/decisions`, {}, 500)).filter(isRollCall);
const items = await getAll(`/meetings/MTG-PL-${DAY}/vote-results`, {}, 500);
const byId = new Map();
items.forEach((item) => byId.set(String(item.activity_id || lastSegment(item.id)), item));

function langs(value) {
  if (!value) return '—';
  if (typeof value === 'string') return `(plain) ${value.slice(0, 50)}`;
  const keys = Object.keys(value);
  return `${keys.length} languages [${keys.slice(0, 14).join(' ')}]` +
    (value.en ? `\n        en: ${String(value.en).slice(0, 90)}` : '\n        NO ENGLISH');
}

for (const decision of decisions) {
  const key = String(decision.notation_votingId || lastSegment(decision.activity_id));
  if (WANTED.indexOf(key) === -1) continue;
  console.log(`\n=== vote ${key}`);
  console.log(`  decision label: ${langs(decision.activity_label)}`);

  const item = [].concat(decision.inverse_consists_of || [])
    .map((e) => (typeof e === 'string' ? e : (e && e.id) || ''))
    .map((id) => byId.get(lastSegment(id))).find(Boolean);
  console.log(`  item label:     ${item ? langs(item.activity_label) : 'no item'}`);
  if (item) console.log(`  item structured:${langs(item.structuredLabel)}`);

  const code = documentCode(english(decision.activity_label)) ||
    (item && [].concat(item.based_on_a_realization_of || [])
      .map((e) => (typeof e === 'string' ? e : (e && e.id) || ''))
      .map((u) => (/doc\/([A-Z-]+\d?-\d{4}-\d{4})/.exec(u) || [])[1]).find(Boolean));
  if (!code) { console.log('  document:       none named'); continue; }

  const pathname = /^[A-Z]/.test(code) && code.includes('-') ? code
    : code.replace(/^([A-Z]+(?:-[A-Z]+)?)(\d{1,2})-(\d{4})\/(\d{4})$/, '$1-$2-$4-$3');
  try {
    const payload = await get(`/documents/${pathname}`, {});
    const row = (payload && payload.data && payload.data[0]) || null;
    console.log(`  document ${pathname}`);
    console.log(`    title_dcterms: ${row ? langs(row.title_dcterms) : 'nothing'}`);
    if (row && row.label) console.log(`    label:         ${langs(row.label)}`);
  } catch (error) {
    console.log(`  document ${pathname}: ${String(error.message).slice(0, 50)}`);
  }
}
