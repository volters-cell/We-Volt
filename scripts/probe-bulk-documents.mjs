#!/usr/bin/env node
/*
 * Can the documents of a year be read in one go?
 *
 * Labelling votes one document at a time is costing an hour. A term is a few
 * hundred reports and the pass asks for each of them separately, paced a
 * quarter-second apart so as not to lean on the portal — which is the right
 * manner and the wrong shape. The portal pages its collections, and
 * /procedures?year=2021 answered when it was tried, so /documents?year=2024
 * may hand over every report of a year in a handful of requests instead of
 * four hundred.
 *
 * Worth knowing before the next run, and worth knowing whether the bulk rows
 * carry creator — a listing that omits it would save nothing, because every
 * document would still need reading individually for the one field that
 * matters.
 *
 * Reads and prints. Writes nothing.
 
   SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { get } from './lib/portal.mjs';
import { committeeOf } from './lib/committees.mjs';

for (const query of [
  { year: 2024, limit: 5 },
  { year: 2024, limit: 5, 'work-type': 'REPORT' }
]) {
  const label = JSON.stringify(query);
  try {
    const payload = await get('/documents', query);
    const rows = (payload && payload.data) || [];
    console.log(`\n/documents ${label}`);
    console.log(`  ${rows.length} rows`);
    if (!rows.length) continue;
    console.log(`  keys: ${Object.keys(rows[0]).join(', ')}`);
    let withCreator = 0;
    rows.forEach(function (row) {
      const committee = committeeOf(row.creator);
      if (committee) withCreator += 1;
      console.log(`    ${String(row.identifier || row.id).slice(0, 26).padEnd(28)} ` +
        `${committee || '—'}`);
    });
    console.log(`  ${withCreator} of ${rows.length} name a committee`);
  } catch (error) {
    console.log(`\n/documents ${label}\n  ${String(error.message).slice(0, 70)}`);
  }
}

/* And how many there are in a year, which decides whether paging is sane. */
try {
  const payload = await get('/documents', { year: 2024, limit: 1, offset: 0 });
  console.log('\ncount fields on the envelope: ' +
    Object.keys(payload || {}).filter((k) => k !== 'data').join(', '));
} catch (error) {
  console.log(`\ncount: ${String(error.message).slice(0, 60)}`);
}
