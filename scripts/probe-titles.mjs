#!/usr/bin/env node
/*
 * What joins a ninth-term decision to the item that names its subject?
 *
 * The first run of this probe settled that the subjects are published. Every
 * sitting tried answers with vote-result items carrying real titles —
 * "Programme InvestEU" — beside decisions titled "A9-0002/2020 - Geert
 * Bourgeois - Consent procedure 12/02/2020 12:09:01.000". None of them join:
 * the decision is keyed 128487 and the item MTG-PL-2021-03-09-VOT-ITM-929650,
 * which are not the same kind of thing. The importer matches the decision's
 * votingId against the item's activity_id, so in the ninth term it matches
 * nothing and falls back to the label. That is the whole of the defect.
 *
 * It also showed the document endpoint answering to A-9-2020-0002, with the
 * title under title_dcterms rather than title — which is why the first run
 * read it as null.
 *
 * So: print both records whole, and look for the field that points from one to
 * the other. Guessing at it from the outside is how the earlier joins were
 * written.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get, getAll, english, isRollCall } from './lib/portal.mjs';

const DATE = '2021-03-09';

const decisions = await getAll(`/meetings/MTG-PL-${DATE}/decisions`, {}, 500);
const items = await getAll(`/meetings/MTG-PL-${DATE}/vote-results`, {}, 500);
console.log(`${DATE}: ${decisions.length} decisions, ${items.length} items\n`);

const decision = decisions.find(isRollCall) || decisions[0];
const item = items[0];

console.log('a decision, whole:');
console.log(JSON.stringify(decision, null, 1).slice(0, 2600));

console.log('\nan item, whole:');
console.log(JSON.stringify(item, null, 1).slice(0, 2600));

/* Does either side name the other? Compare every string an item holds against
   every decision's key, and the other way round, rather than picking a field
   and hoping. */
function strings(value, out) {
  out = out || [];
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => strings(entry, out));
  return out;
}

console.log('\ndoes either side name the other?');
const decisionKeys = new Set(decisions.map((d) => String(d.notation_votingId || '')).filter(Boolean));
let itemsNamingADecision = 0;
for (const row of items) {
  if (strings(row).some((text) => decisionKeys.has(text) || [...decisionKeys].some((key) => text.includes(key)))) {
    itemsNamingADecision += 1;
  }
}
console.log(`  ${itemsNamingADecision} of ${items.length} items name a decision's votingId somewhere`);

const itemIds = items.map((row) => String(row.activity_id || '')).filter(Boolean);
let decisionsNamingAnItem = 0;
for (const row of decisions) {
  if (strings(row).some((text) => itemIds.some((id) => text.includes(id)))) decisionsNamingAnItem += 1;
}
console.log(`  ${decisionsNamingAnItem} of ${decisions.length} decisions name an item's id somewhere`);

/* And the document, read properly this time. */
console.log('\nthe document, with the right field:');
const payload = await get('/documents/A-9-2020-0002', {});
const row = (payload && payload.data && payload.data[0]) || {};
console.log(`  title_dcterms: ${JSON.stringify(english(row.title_dcterms)).slice(0, 200)}`);
console.log(`  label:         ${JSON.stringify(english(row.label)).slice(0, 200)}`);
