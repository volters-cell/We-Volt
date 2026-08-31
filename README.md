# EU Tracker

**Every vote of the European Parliament, member by member, shown country by
country on a map.**

EU Tracker reads the European Parliament's own published record of each sitting and
presents it as a map and a searchable list: how each member state's delegation voted,
how each political group voted, and how each MEP voted, one vote at a time.

The Parliament publishes the result of each recorded vote as an annex listing every
member and their position. This project imports those files, joins the member ids to names, countries
and groups, and stores one record per vote so the same result can be read either by
vote or by member.

## What it does today

The page opens on the Union itself: the 27 member states in the Union's own blue, the
rest of Europe in grey, and beside them every vote on record — Parliament votes,
Council votes and Commission acts in one unfolded list, searchable and filterable by
institution. Click a country and you get its profile; pick a vote and the map redraws in
one of two layers:

| Layer | Answers |
| --- | --- |
| **How they voted** | The member state's position. In Parliament files: where most of the delegation voted, the breakdown by political group, and — where the individual ballots have been imported — every MEP by name. |
| **What it costs** | Hidden until a decision carries sourced cost figures. The data model supports it and the interface brings the layer back on its own the moment real numbers exist — see below. |

The 27 member states sit on a map that shows their neighbours — the UK, Norway,
Iceland, Switzerland, Ukraine, Belarus, the Western Balkans, Türkiye, Moldova, the
Caucasus and Greenland — in grey, so the Union is shown in its geographic context. Only
member states carry vote data; the grey countries open a short factual profile.

Opening a country also shows which organisations it belongs to — EU, euro area,
Schengen and NATO — each with the year it joined, and a note where it is outside one.
Those chips are buttons: clicking one highlights that bloc across the whole map.

The map holds the left of the screen while the reading column on the right carries the
feed, the decision and the country record. Clicking a country opens it; clicking the
sea, pressing Escape, or the panel's own Close button shuts it again.

Opening a decision animates the result: the whole Union takes the colour of the
outcome, holds, then each member state turns to its own vote in a sweep from west to
east while the totals count up. There is a Replay control, and the
whole sequence is skipped for readers who ask for reduced motion. Vote counts are
written in the colour of the vote they count, everywhere they appear. Clicking a
legend entry isolates that group on the map and in the table; pointing at a row lights
up the country, and the other way round.

Each decision is scored by its own rule, not a generic one: qualified-majority files
get the 15-of-27 and 65%-of-population meters and a verdict on whether a blocking
minority formed; unanimity files are measured against all 27, where an abstention does
not block but a single vote against does; Commission acts have no country vote at all,
and say so.

The page opens on the search box. Below it, votes are grouped into the plenary sessions
they were taken in — "Strasbourg · 6–9 Jul 2026" — folded until you unfold one, or all
of them at once. Searching unfolds whatever it finds. A search matches a word from a
title, a procedure reference, or — inside an open vote — an MEP by name, party or group,
which jumps to that member's country.

Political groups are shown with their conventional colours; drop an artwork file into
`assets/groups/` and it replaces the colour with that group's own logo — see the README
there, including on whose marks those are.

Open a vote and the whole chamber is there: a bar showing how it split, then the
result broken down three ways — **MEPs**, **Political groups**, **Countries** — with
filters for name, group, country and position. Every part of the bar is a filter:
click the red block and you get the 169 members who voted against. Click a group or a
country row to narrow to it, or any name to follow that member across every vote.

The header says when the last plenary session ran and where, and when the next one
starts, from the Parliament's own calendar.

Links are made on demand: **Copy link to this vote**, and one in every country panel,
put a real pasteable address on the clipboard. **Instagram** draws the open vote as a
1080x1920 picture — title, result, the split, the totals, and a QR code that opens that
vote — and opens the phone's own share sheet with it, where Instagram offers Add to
story. The link goes on the clipboard at the same time, so Instagram's link sticker
offers it with one paste. No web page can post into Stories by itself; on a desktop the
image is saved instead. The QR code is generated in the page (`assets/js/qr.js`), not
fetched from an image service. Browsing does not write to the address
bar, so reopening the site brings you back to the search page rather than to whatever
you last clicked.

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
npm run members   # rebuild the per-member records after importing votes
npm test          # import logic + data validation
npm run validate  # data validation on its own
npm run sessions  # fetch the plenary calendar
npm run backfill  # import every sitting since the 2024 elections
npm run bundle    # dist/eu-tracker.html — the whole site as one file
```

[about.html](about.html) documents the sources: where each vote comes from, what
processing is applied to it, what the dataset does and does not cover, and the licence
on each part.

## The data

**Coverage is verified against the source.** 718 votes — every main vote
the Parliament has taken since the term began on 16 July 2024 — with every member by
name, their group, and how each of them voted. 495,164 individual ballots.

`scripts/audit-sources.mjs` walks all 112 sittings of the term at the Parliament and
compares vote by vote. As of 24 August 2026: 679 votes on a text, 647 of them published
with ballots and all 647 held here, 32 recorded with no ballots published,
and **no record whose figures disagree with the Parliament's own**.

Everything comes from the European Parliament's own record, read from its open data portal
at `data.europarl.europa.eu`: each sitting's decisions, which name every member and how they
voted; the vote items behind them; the list of members; and the list of sittings.
`scripts/fetch-plenary.mjs` reads them and keeps the site current after each sitting;
`npm run backfill` re-reads the whole term.

Not currently covered: Council and Commission records, for which no machine-readable
source is available, and the plain-language summaries, which are written by hand. Any
sample record is labelled as one in the file (`"status": "sample"`), on the page (a
banner and a chip), and in the validator, which rejects a sample that loses its label.

```
data/
  eu-countries.geo.json          the map: 27 member states, 25 neighbours in grey
  reference/
    member-states.json           seats, population, capitals, memberships
    meps.json                    every MEP: name, country, group — stored once
    plenary-calendar.json        when each session sits, and where
  decisions/
    index.json                   built from the folder — never edited by hand
    <vote-id>.json               one vote: metadata and [member id, position] pairs
  meps/
    index.json                   every member, for search
    <member-id>.json             every vote that member cast
```

The two folders are the same 495,164 ballots seen from opposite ends: `decisions/`
answers "who voted how on this", `meps/` answers "how did this person vote on
everything". Both are built by scripts; neither is edited by hand.

`index.json` is generated, so adding a decision is one file plus one command:

```bash
node scripts/build-index.mjs    # rebuilds the feed, newest first
```

A real record is made by importing a published vote and then adding the
country-level reporting by hand:

```bash
node scripts/fetch-plenary.mjs --date 2026-09-15    # one sitting
node scripts/build-index.mjs                        # rebuild the feed
```

That reads the Parliament's record of the sitting, maps every voter's id to a name and a
country through the member directory, and writes one record per final vote with each
MEP's own vote in it. The summary field is left empty: summaries are written by hand.

**It can run itself.** `.github/workflows/plenary-sync.yml` imports during the sitting
and again each night — the second pass catching whether each text carried, which the
Parliament publishes a day later than the votes themselves — then validates and commits
only if something changed. Set it up, and verify the first run, following
[docs/AUTOMATION.md](docs/AUTOMATION.md).

The full field reference is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md).

**Following a party across every vote.** The Parliament records a member's country and
political group but not the party they were elected for, so parties worth following as a
bloc are listed by person id in `data/reference/delegations.json`. Each one gets a line
under the outcome of every vote — Volt's five members, for instance — read from that
vote's own ballots, so nothing is inferred: a member with no ballot did not vote. Adding
a party is adding its members' ids to that file.

**One rule for every number on the page.** Denominators come from seats, never from the
ballots a record happens to carry: the chamber has 720, a delegation has what its member
state holds. Records imported from the portal name only the members who voted — the
portal does not publish absences — so counting ballots would make "of N members" mean
something different on every vote.

## Design decisions

- **Static files.** The site is JSON and JavaScript served as static files, with no
  backend and no build step, so it can be hosted anywhere and forked as it stands.
  Votes are stored as `[member id, position]` pairs against a member directory held
  once: about 104 MB rather than 0.9 GB for a five-year term.
- **Every figure carries its source.** The validator treats an unsourced cost figure as
  an error. The bundled records carry no cost figures, so that layer is not shown; it
  appears for any decision that has sourced ones.
- **Missing data is shown as missing.** A country with no coverage indexed is drawn
  pale on the map and says so in its panel.
- **Sample records stay labelled.** The validator enforces it.

## Where the data comes from

Votes come from the European Parliament itself, through its open data portal:
each sitting's decisions, which record who voted for, against and abstained, and the
list of members that turns those ids into names, countries and groups. Nothing sits in
between. Boundaries come from public-domain
Natural Earth data, simplified for display only — they imply no position on any
border.

## Where it is going

Planned: a multilingual interface, plain-language summaries for the votes that have
none, national parties resolved so any party can be followed as a bloc, embeddable
views, and an inset for the outermost regions. The full plan is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Licence

Code: MIT. Data files authored here: CC BY 4.0. Imported records stay under the terms
of their source.
