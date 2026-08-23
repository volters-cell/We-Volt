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

The page opens on the Union itself: the 27 member states in the Union's own blue, the
rest of Europe in grey, and beside them every vote on record — Parliament roll-calls,
Council votes and Commission acts in one unfolded list, searchable and filterable by
institution. Nothing is chosen for the reader. Click a country and you get its profile;
pick a vote and the map redraws in one of two layers:

| Layer | Answers |
| --- | --- |
| **How they voted** | The member state's position. In Parliament files: where most of the delegation voted, the breakdown by political group, and — where a real roll-call has been imported — every MEP by name. |
| **Press framing** | The coverage indexed for that country, each item tagged supportive, critical, mixed or neutral. |
| **What it costs** | Hidden until a decision carries sourced cost figures. The data model supports it and the interface brings the layer back on its own the moment real numbers exist — see below. |

The 27 member states sit on a map that shows their neighbours — the UK, Norway,
Iceland, Switzerland, Ukraine, Belarus, the Western Balkans, Türkiye, Moldova,
Kaliningrad — in grey, so the Union is placed rather than floating. Only the member states are
clickable.

Opening a country also shows which clubs it is in: EU, euro area, Schengen and NATO,
each with the year it joined, and a note where it stayed out — "outside Schengen"
means something very different for Ireland than it does for Cyprus. Those chips are
buttons: clicking one lights up that bloc across the whole map.

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

The page opens on the search box. Below it, votes are grouped into the plenary sessions
they were taken in — "Strasbourg · 6–9 Jul 2026" — folded until you unfold one, or all
of them at once. Searching unfolds whatever it finds. A search matches a word from a
title, a procedure reference, or — inside an open vote — an MEP by name, party or group,
which jumps to that member's country.

Open a vote and **How every member voted** lists the whole roll-call: each member state
with its position and totals, every MEP by name where the record carries them, and a
filter for a country, a group, a party or a person.

The header says when the last plenary session ran and where, and when the next one
starts, from the Parliament's own calendar.

Also: a sortable table of all 27 member states, and links made on demand — **Link to
this vote**, and one in every country panel — so a journalist can point straight at
`#/<vote>/PL`. Browsing does not write to the address bar, so reopening the site brings
you back to the search page rather than to whatever you last clicked.

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

## The data

**The votes are real.** 614 roll-call votes — every main vote the Parliament has taken
since the term began on 16 July 2024 — with all 720 members by name, their group, and
how each of them voted. 441,322 individual ballots.

They were imported from the [HowTheyVote.eu dataset](https://github.com/HowTheyVote/data),
which compiles the Parliament's own roll-call annexes and publishes them as CSV.
**Using it requires crediting them**, which the footer, every record's `sources` and this
file do; check their current data licence at howtheyvote.eu/about before publishing.
`scripts/fetch-plenary.mjs` reads the Parliament's annexes directly and carries no such
obligation — that is the long-term route, and it is what keeps the site current after
each sitting.

Still missing, and honestly labelled as such: Council and Commission records, which have
no machine-readable source; the plain-language summaries, which are editorial; and the
press coverage, which is the part that needs journalists. Every sample is flagged as one, in
the file (`"status": "sample"`), on the page (a banner and a chip), and in the
validator, which refuses to let a sample lose its label.

```
data/
  eu-countries.geo.json          the map: 27 member states, 23 neighbours in grey
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

The two folders are the same 441,322 ballots seen from opposite ends: `decisions/`
answers "who voted how on this", `meps/` answers "how did this person vote on
everything". Both are built by scripts; neither is edited by hand.

`index.json` is generated, so adding a decision is one file plus one command:

```bash
node scripts/build-index.mjs    # rebuilds the feed, newest first
```

A real record is made by importing a published roll-call and then adding the
country-level reporting by hand:

```bash
node scripts/fetch-plenary.mjs --date 2026-09-15    # one sitting
node scripts/build-index.mjs                        # rebuild the feed
```

That reads the Parliament's own roll-call annex for the sitting, maps every member to
their country through the MEP directory, and writes one record per final vote with
each MEP's own vote in it. It deliberately leaves the summary and press sections
empty: those are editorial work, and nothing should generate them.

**It can run itself.** `.github/workflows/plenary-sync.yml` imports during the sitting
and again each night — catching the votes list, which states what carried and is
published a day later than the votes themselves — then validates and commits only if
something changed. Set it up, and verify the first run, following
[docs/AUTOMATION.md](docs/AUTOMATION.md).

The full field reference is in [docs/DATA-MODEL.md](docs/DATA-MODEL.md); how to file a
country's press coverage is in [docs/CONTRIBUTING-DATA.md](docs/CONTRIBUTING-DATA.md).

## Why it is built this way

- **Static files, and cheap ones.** The whole site is JSON and JavaScript on a CDN. A
  newsroom can fork it, a grant can end, and the thing still runs. Votes are stored as
  `[member id, position]` pairs against a directory held once, which is the difference
  between 104 MB and 0.9 GB for a five-year term — and between free hosting and a bill.
- **Every figure carries its source.** A cost estimate without a citation is an
  opinion; the validator treats it as an error. The bundled records carry no cost
  figures at all, because none of them could be sourced — so that layer does not
  appear. It returns automatically for any decision that has real ones.
- **The gaps are visible.** A country with no coverage indexed is pale on the map and
  says so in the panel. The absence is part of the story.
- **Sample data can never masquerade as a record.** That rule is enforced in code.

## Where the data comes from

Roll-call votes come from the European Parliament itself: the roll-call annex
published with the minutes of each sitting, and the MEP directory that turns the names
in it into countries. Nothing sits in between. Boundaries come from public-domain
Natural Earth data, simplified for display only — they imply no position on any
border.

## Where it is going

Multilingual interface, national press partners filing coverage in their own
languages, an inset for the outermost regions, and a decision archive rather than a
handful of files. The plan, and its fit with the Creative Europe journalism
partnerships strand, is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Licence

Code: MIT. Data files authored here: CC BY 4.0. Imported records stay under the terms
of their source.
