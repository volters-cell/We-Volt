# The data model

One decision is one JSON file in `data/decisions/`, listed in `data/decisions/index.json`.
Nothing else in the project holds editorial content. If you can write JSON, you can
publish a record; `npm run validate` will tell you what is missing.

## The decision file

```jsonc
{
  "id": "council-2026-hgv-co2-standards",   // matches the filename
  "status": "sample",                       // "sample" or "verified" — see below
  "dataNote": "…",                          // required while status is "sample"
  "body": "council",                        // "parliament" | "council" | "commission"
  "bodyLabel": "Council of the European Union",
  "title": "CO₂ standards for new heavy goods vehicles",
  "subtitle": "Final adoption by qualified majority",
  "date": "2026-05-27",                     // YYYY-MM-DD, the day of the decision
  "voteRule": "qualified-majority",         // qualified-majority | simple-majority | unanimity | not-a-vote
  "voteRuleLabel": "Qualified majority (55% of states, 65% of population)",
  "procedure": { "reference": "2025/0211(COD)", "url": null },
  "summary": "Two or three sentences in plain language.",
  "whatItMeans": ["One consequence per line."],
  "outcome": { "result": "adopted", "headline": "One sentence a reader can quote." },
  "impactUnit": "EUR per person per year",  // the unit every impact figure uses
  "impactLabel": "Estimated transition cost",
  "sources": [{ "label": "Council voting results", "url": "https://…" }],
  "countries": { "AT": { … }, "BE": { … } }  // all 27, always
}
```

`status` is the honesty switch. `sample` puts a banner across the page and a chip on
every figure; `verified` removes them. There is no third state: a record is either
sourced or it is labelled.

## A country entry

```jsonc
"PL": {
  "position": "against",              // for | against | abstain | absent | not-applicable
  "representative": "Minister of Infrastructure",   // Council files: who cast the vote

  "mepGroups": [                      // Parliament files: the delegation by group
    { "group": "EPP", "seats": 22, "for": 7, "against": 9, "abstain": 5, "absent": 1 }
  ],

  "meps": [                           // Parliament files: the roll-call itself
    { "name": "…", "party": "…", "group": "EPP", "vote": "for", "id": 12345 }
  ],

  "impact": {
    "value": -19.6,                   // negative = cost to this member state
    "note": "What the number measures, in one sentence.",   // required with a value
    "source": { "label": "…", "url": "https://…" },
    "sample": true                    // drop this once the figure is sourced
  },

  "note": "Anything a reader needs that the fields above cannot hold."
}
```

### How the app reads it

- **Position on the map.** Council and Commission files use `position` directly. For
  Parliament files the delegation's position is derived from its own votes: the
  largest of for/against/abstain wins, and when the top two are within 15 points of
  each other the country is drawn hatched and labelled *delegation split*. A 43–38
  delegation is a different story from a unanimous one, and the map should say so.
- **MEP numbers.** If `meps` is present it is counted directly; otherwise `mepGroups`
  is summed. Both must add up to the member state's seat count — the validator checks
  it against `data/reference/member-states.json`.
- **Council arithmetic.** The qualified majority is computed live from the positions
  and the population table: 55% of member states (15 of 27) and 65% of the population.
  Abstentions count against, because in the Council they do. A blocking minority needs
  at least four member states holding more than 35% of the population; the outcome box
  says whether one formed and by how much it missed.
- **Impact.** The whole cost layer is optional and data-driven: if no country in a
  decision carries an `impact.value`, the map tab, the panel card and the table column
  are all absent, and they reappear as soon as one does. Values are bucketed into three
  steps either side of zero, scaled to the decision's own range, so a file measured in
  cents per head reads as clearly as one in tens of euros. Missing values are drawn as
  *no measurable effect*, never as zero cost. None of the bundled sample records carry
  cost figures — an unsourced number is worse than a blank.

## Following one member

`data/meps/` is the same ballots seen from the other end. `index.json` lists every
member for search; `<member-id>.json` holds one member's whole record:

```jsonc
{
  "id": 197490,
  "name": "…", "country": "MT", "group": "EPP", "party": null,
  "totals": { "for": 398, "against": 75, "abstain": 5, "absent": 136 },
  "votes": [[195775, 3], [195774, 0]]      // [vote id, position], newest first
}
```

Built by `node scripts/build-members.mjs` after any import, never by hand. A reader
following one MEP would otherwise have to download every vote file to answer a question
about one person; this way it is a few kilobytes.

## Reference data

`data/reference/member-states.json` holds the seat counts (720 across 27 states, from
the European Council decision on the Parliament's composition), populations used for
the Council arithmetic, capitals and accession years. Council population figures are
fixed annually — refresh this file each year and note the source in its `metadata`.

Each member state also carries its memberships, which the country panel shows as
chips and which the map can isolate:

```jsonc
"memberships": {
  "euro":     { "member": true,  "since": 2026 },
  "schengen": { "member": true,  "since": 2025, "note": "Air and sea borders opened in 2024, land borders in 2025." },
  "nato":     { "member": false, "note": "Neutrality written into constitutional law since 1955." }
}
```

`since` is the year the thing actually took effect — for Schengen, the year internal
border controls came down, not the year the agreement was signed. A country outside a
bloc carries a `note` saying why, because "outside Schengen" means something very
different for Ireland than it does for Cyprus. Update this file when a member state
joins; `metadata.membershipsAsOf` records what year it was last checked.

`data/eu-countries.geo.json` is built from public-domain boundaries by
`scripts/build_map_data.py`. It holds two kinds of feature, told apart by
`properties.member`:

- **`member: true`** — the 27 member states. Interactive, labelled, coloured by the
  layer.
- **`member: false`** — the neighbours: the UK, Norway, Iceland, Switzerland, Ukraine,
  Belarus, the Western Balkans, Türkiye, Moldova and Kaliningrad. Drawn in grey behind
  everything, unlabelled, and invisible to the pointer, the keyboard and the screen
  reader. The view is fitted to the member states alone, so neighbours run off the
  edge and the viewBox crops them — a country cut off at the frame looks right where a
  country missing entirely looks broken.

The file is around 80 KB, small enough to ship without a tile server and detailed
enough to recognise your own coastline.

```bash
python3 scripts/build_map_data.py path/to/europe.geojson data/eu-countries.geo.json
```

The outermost regions — the Azores, Madeira, the Canaries, the French overseas
departments — fall outside the window and are not drawn. They are part of their member
states and of the Union; giving them an inset is on the roadmap.

## Adding a decision

1. Import a Parliament roll-call, or start from an empty file for a Council or
   Commission act:
   ```bash
   node scripts/fetch-plenary.mjs --date <YYYY-MM-DD>
   ```
   See [AUTOMATION.md](AUTOMATION.md) for the sources and the schedule.
2. Write `summary`, `whatItMeans` and `outcome.headline` — plain language, no jargon
   that a reader would have to look up.
3. Add impact figures with their sources, or leave them out. An unsourced number is
   worse than a blank.
4. Run `node scripts/build-index.mjs` to put it in the feed.
5. Run `npm test`. Green means it is publishable.
