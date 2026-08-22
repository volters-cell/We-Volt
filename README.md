# EU Tracker

**One European decision at a time, shown country by country: who voted how, what it
costs each member state, and how each national press told the story.**

Open the map. Click a country. That is the whole interface.

Brussels publishes almost everything and explains almost nothing. A roll-call vote
arrives as a PDF annex with 720 names in it. A Council decision arrives as a line in a
press release. What none of it answers is the question a reader in Poznań or Palermo
actually asks: *what did **we** do, and what does it mean for **us**?* EU Tracker is
built around that question, and around a second one that no institution answers at
all — *what did everybody else's newspapers say about it?*

## What it does today

The page opens on the map with a feed of the most recent decisions beside it —
Parliament roll-calls, Council votes and Commission acts in one list, filterable by
institution, so both chambers can be tracked from the same screen. Pick one, and three
layers redraw the map:

| Layer | Answers |
| --- | --- |
| **How they voted** | The member state's position. In Parliament files: the delegation's majority, its split, the breakdown by political group, and — where a real roll-call has been imported — every MEP by name. |
| **Press framing** | The coverage indexed for that country, each item tagged supportive, critical, mixed or neutral. |
| **What it costs** | Hidden until a decision carries sourced cost figures. The data model supports it and the interface brings the layer back on its own the moment real numbers exist — see below. |

The map holds the left of the screen while the reading column on the right carries the
feed, the decision and the country record. Clicking a country opens it; clicking the
sea, pressing Escape, or the panel's own Close button shuts it again.

Opening a decision plays it rather than printing it: the whole Union takes the colour
of the outcome, holds for a beat, then each member state turns to its own vote in a
sweep from west to east while the totals count up. There is a Replay control, and the
whole sequence is skipped for readers who ask for reduced motion. Vote counts are
written in the colour of the vote they count, everywhere they appear. Clicking a
legend entry isolates that group on the map and in the table; pointing at a row lights
up the country, and the other way round.

Each decision is scored by its own rule, not a generic one: qualified-majority files
get the 15-of-27 and 65%-of-population meters and a verdict on whether a blocking
minority formed; unanimity files are measured against all 27, where an abstention does
not block but a single vote against does; Commission acts have no country vote at all,
which is exactly why their cost and press layers matter.

Also: a sortable table of all 27 member states, and a permalink for every country so a
journalist can link straight to `#/<decision>/PL`.

It works with a keyboard: arrow keys walk between neighbouring countries, Enter opens
one, Escape closes. Malta and Luxembourg have click targets as big as everyone else's.

## Run it

No build step, no dependencies. It is HTML, CSS and three files of plain JavaScript.

```bash
git clone https://github.com/volters-cell/We-Volt.git
cd We-Volt
python3 -m http.server 8000     # or: npm start
# open http://localhost:8000
```

It must be served over HTTP — the records are fetched as JSON, so a `file://` path
will not work.

```bash
npm test          # ingest logic + data validation
npm run validate  # data validation on its own
npm run bundle    # dist/eu-tracker.html — the whole site as one file
```

## The data

**Everything bundled in this repository right now is an illustrative sample.** The
seven decisions are placeholders that show how a record is laid out; the map, the
seat counts and the population figures are real, and no cost estimates are shipped
because none could be sourced. Every sample is flagged as one, in
the file (`"status": "sample"`), on the page (a banner and a chip), and in the
validator, which refuses to let a sample lose its label.

```
data/
  eu-countries.geo.json          the 27 member states, simplified for display
  reference/member-states.json   seats, population, capitals, accession years
  decisions/
    index.json                   built from the folder — never edited by hand
    <decision-id>.json           one decision, one file
```

`index.json` is generated, so adding a decision is one file plus one command:

```bash
node scripts/build-index.mjs    # rebuilds the feed, newest first
```

A real record is made by importing a published roll-call and then adding the
country-level reporting by hand:

```bash
node scripts/ingest-roll-call.mjs --vote 168393 --out data/decisions
```

That pulls the Parliament's roll-call (via [HowTheyVote.eu](https://howtheyvote.eu),
which republishes the official annexes), groups it by member state, and writes every
MEP's own vote into the record. It deliberately leaves the impact and press sections
empty: those are editorial work, and nothing should generate them.

The full field reference is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md); how to file a
country's press coverage is in [docs/CONTRIBUTING-DATA.md](docs/CONTRIBUTING-DATA.md).

## Why it is built this way

- **Static files.** The whole site is JSON and JavaScript on a CDN. A newsroom can
  fork it, a grant can end, and the thing still runs.
- **Every figure carries its source.** A cost estimate without a citation is an
  opinion; the validator treats it as an error. The bundled records carry no cost
  figures at all, because none of them could be sourced — so that layer does not
  appear. It returns automatically for any decision that has real ones.
- **The gaps are visible.** A country with no coverage indexed is pale on the map and
  says so in the panel. The absence is part of the story.
- **Sample data can never masquerade as a record.** That rule is enforced in code.

## Standing on other people's work

[HowTheyVote.eu](https://howtheyvote.eu) made European roll-call votes legible before
anyone else did, and this project imports their republished records rather than
re-scraping the annexes. EU Tracker starts where they stop: at the map, at the cost,
and at the press. Boundaries come from public-domain Natural Earth data, simplified
for display only — they imply no position on any border.

## Where it is going

Multilingual interface, national press partners filing coverage in their own
languages, an inset for the outermost regions, and a decision archive rather than a
handful of files. The plan, and its fit with the Creative Europe journalism
partnerships strand, is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Licence

Code: MIT. Data files authored here: CC BY 4.0. Imported records stay under the terms
of their source.
