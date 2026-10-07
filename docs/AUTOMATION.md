# Following the plenary automatically

The goal: the day after a plenary session, the site already holds that session's
votes, country by country, without anybody opening a terminal.

## Where the votes come from

Everything comes from the European Parliament itself, through its open data portal at
`data.europarl.europa.eu/api/v2`. No third-party service sits in between, which means no
dependency on somebody else's uptime, rate limits or licence terms. The portal needs no
key and no account, answers JSON-LD, and publishes under the Commission's reuse decision.

| Endpoint | What it gives |
| --- | --- |
| `/meetings?year={year}` | Every sitting of a year, with its date, its parliamentary term and its locality (`FRA_SXB` is Strasbourg, `BEL_BRU` is Brussels) |
| `/meetings/MTG-PL-{date}/decisions` | Every decision taken that day. A roll-call carries `had_voter_favor`, `had_voter_against` and `had_voter_abstention`: one person id per member who voted that way, plus the totals and, once published, whether the text carried |
| `/meetings/MTG-PL-{date}/vote-results` | The vote items those decisions belong to — the readable title, the report, the procedure |
| `/meps/show-current` | Every sitting member with their id, country and political group |
| `/meps?parliamentary-term={term}` and `/meps/{id}` | Everyone who has held a seat this term, including those who have since left, and the mandate that names their country |

Four things follow from how the Parliament publishes:

- **The website cannot be read by a machine.** `www.europarl.europa.eu` answers every
  automated request — the roll-call annex, the MEP directory, the session calendar —
  with `202` and an empty body, whatever the address or the user agent. It is a bot
  wall, not a missing page. So a record names as its source the open data it was
  actually read from, and nothing else. `.github/workflows/probe-sources.yml`
  is the dispatchable job that establishes this, and re-establishes it if the
  behaviour ever changes.
- **A ballot is a list of ids, not of names.** The portal identifies a voter as
  `person/197628` and nothing more, so the member directory is not a convenience but
  the thing that makes a vote legible. It is cached in `data/reference/meps.json` and
  refreshed on every run.
- **The result arrives later than the votes.** A sitting's decisions appear during the
  day; whether the text carried is filled in afterwards. A same-day import derives the
  result from the totals and says so in its `dataNote`; a later run replaces it with
  the Parliament's own and drops the caveat. This is why the schedule re-imports the
  past fortnight every night.
- **An amendment says what it amends.** A decision on an amendment carries
  `decisionAboutId`; a vote on the text as a whole does not. The default filter is
  that fact, not a guess at the wording of a title.

## Running it by hand

```bash
node scripts/fetch-sessions.mjs                         # the plenary calendar, first
node scripts/fetch-plenary.mjs --date 2026-09-15        # one sitting
node scripts/fetch-plenary.mjs --since 2026-09-01       # every sitting since
node scripts/fetch-plenary.mjs --date 2026-09-15 --all  # amendments as well
node scripts/fetch-plenary.mjs --date 2026-09-15 --dry-run
node scripts/build-index.mjs && node scripts/validate-data.mjs
```

The importer asks the portal which days the Parliament sat and looks only at those, so
it never guesses at dates. The calendar fetch is for the site rather than the importer:
it is what lets the page say when the last session was, where it sat, and when the next
one starts.

With no arguments the importer covers the last fortnight, which takes in a plenary that
has just finished.

**Only final votes are imported by default.** A plenary produces hundreds of roll
calls, and the overwhelming majority are amendments — importing them all would bury
the decisions that matter under procedural noise. The filter skips any decision the portal marks
as being about an amendment. `--all` overrides it. It is `isFinalVote` in
`scripts/fetch-plenary.mjs`, four lines long.

## Running it on a schedule

Everything the site needs runs on GitHub Actions by itself. Times are UTC; GitHub may
start a scheduled run some minutes late.

| Workflow | When | What it does |
| --- | --- | --- |
| `plenary-sync.yml` | Every two hours, 08:05–20:05, on a sitting day and the day after | Imports the sitting's votes as they are published |
| `plenary-sync.yml` | Every night, 21:30 | Re-imports the past fortnight: the Parliament's own result replaces the one derived from the totals, and anything published late is picked up |
| `plenary-sync.yml` | Mondays, 04:00 | Refreshes the plenary calendar and the member directory, and adds a new Parliament after an election (see below) |
| `profiles-sync.yml` | The 2nd of each month, 04:20 | Reads members' portraits and national parties |
| `faces-mirror.yml` | The 3rd, 04:40 | Mirrors the portraits onto the site |
| `audit-sources.yml` | The 5th, 05:00 | Compares every sitting with what is on file, imports any vote found missing, audits again |
| `retitle.yml` | Saturdays, 03:47 | Puts the English title on votes of the last four months that came in another language |
| `summaries.yml` | Sundays, 03:17 | Quotes what each vote of the last four months asks for, once its text is published |
| `keep-schedules-alive.yml` | The 15th, 06:11 | Switches every schedule above back on, in case GitHub turned it off (see below) |

Each job that changes something commits it through `scripts/push-changes.sh`, which
retries when another job pushed first — replaying its commit on top and rebuilding the
index from both — and then publishes the site. The monthly jobs are on different days so
they do not push in the same minute; on 1 October 2026, when they all ran on the 1st, the
profiles job lost a whole month's reading that way.

Each run validates the data and runs the tests before it commits, so a bad import stops
rather than reaching the site. A failed scheduled run is reported by GitHub by e-mail to
whoever last changed that workflow's schedule.

Two settings have to be right for it to work:

1. **Settings → Actions → General → Workflow permissions**: *Read and write*.
   Without this the run imports correctly and then cannot commit.
2. **Settings → Pages**: publishing via GitHub Actions, from the repository's default
   branch — schedules only ever run there.

You can also run any of them from the Actions tab by hand (*Run workflow*).

### GitHub's 60-day rule

GitHub switches off the scheduled workflows of a public repository after 60 days in which
nothing was committed. The site commits most weeks, and the audit commits its report every
month, but the summer recess is long and a schedule switched off then would leave the site
quietly stale. `keep-schedules-alive.yml` asks GitHub once a month to enable each of them
again: for one that is on this changes nothing, for one that was switched off it is back
within the month.

### After an election

The next Parliament is elected in 2029. Which Parliament a vote belongs to is read from
one file, `data/reference/terms.json`, and the Monday calendar refresh adds the new term
to it the first time the Parliament's data lists a sitting of it. From then on, with
nobody editing anything:

- its votes are imported, and the member directory follows the members now sitting;
- they open a fold of their own labelled *This Parliament*; the 2024–2029 one becomes
  *Previous Parliament*;
- the minutes each record cites are addressed under the new term;
- the audit covers the new term.

One thing needs a person: the number of seats. `data/reference/member-states.json` holds
the seats of the Parliament it names in `termNumber`, cited to the Council decision that
set them. Until it is updated to the new decision, the site prints how many members voted
on the new Parliament's votes and no House size, rather than a number that may no longer
be true.

## Checking that nothing is missing

```bash
node scripts/audit-sources.mjs            # the whole term
node scripts/audit-sources.mjs --write    # and save the report
```

This asks the opposite question to the importer's: not "what did I write" but "is
anything missing". It walks every sitting of the term at the portal and compares vote by
vote, matching on the Parliament's own voting id, which each record keeps as `sourceId`.
It reports four things and exits non-zero on any of them: a vote the Parliament published
ballots for and this site does not hold; a record here with no matching vote there; a
tally that disagrees with the Parliament's figures; a ballot naming somebody the member
directory cannot identify.

Two differences are counted rather than flagged, because they are not errors:

- **A roll call with no ballots published.** The Parliament sometimes records a vote as a
  roll call without publishing who voted how. There is nothing to hold; 32 of the term's
  679 votes on a text are like this.
- **Absences held here.** The portal publishes who voted for, against and abstained, and
  not who was absent. Where a record carries absences they came from the fuller archive
  this project started from, so the audit compares only the three positions the portal
  publishes.

`.github/workflows/audit-sources.yml` runs it monthly and writes
`data/reference/coverage.json`, which is what the About page's completeness table quotes.
Any vote it finds missing — usually one that shared a text with another decision and was
folded into it — it imports as a record of its own (`fetch-plenary.mjs --ids`), then
audits again; it fails only if something is still missing after that.

## Verify a real run before trusting the schedule

The endpoints above were each confirmed against live answers from a GitHub runner, and
the shapes the importer reads are pinned by fixtures in `tests/fixtures/` cut down from
those answers. What has not been proved is a full sitting end to end. Before relying on
the schedule, do one supervised run — from the Actions tab, or on any machine that can
reach the portal:

```bash
# 1. Import a sitting you know happened, without writing anything
node scripts/fetch-plenary.mjs --date 2026-07-09 --dry-run

# 2. If the counts look right, write it and check it
node scripts/fetch-plenary.mjs --date 2026-07-09
node scripts/build-index.mjs && node scripts/validate-data.mjs
```

Things worth checking on that run:

- **27 member states**, or an explained shortfall. The importer warns when a ballot
  names a member the directory does not know; `--refresh-meps` usually fixes it.
- **The totals** against the Parliament's own published figures for that vote.
- **Greece**. The Parliament writes it `EL`, and `GRC` in memberships; this project
  writes `GR` throughout, and the conversion is tested.

If the portal changes shape, the whole of the mapping is in `scripts/lib/portal.mjs`
and `buildRecord` in `scripts/fetch-plenary.mjs`, and the fixtures say what it used to
look like.

## Storage: why this stays free

A roll-call with 720 members, stored with every member's name, party and group inside
the record, is 69 KB. A five-year term of them is **0.9 GB** — past what a git
repository or a free static host is comfortable with, and the point at which somebody
starts paying for a database.

Stored the other way — identities in the member directory, once, and the vote itself as
pairs of `[member id, position]` — the same roll-call is **7.9 KB**, and a term is
**104 MB**. That fits inside every free tier: GitHub Pages allows a 1 GB site, and a
reader opening one vote downloads about 1.7 KB.

So the importer writes the compact form by default:

```jsonc
"ballots": [[124834, 0], [124835, 1], [124836, 2]]   // 0 for, 1 against, 2 abstain, 3 absent
```

`--fat` writes the long form instead, if you ever want a record that stands alone
without the directory. The page expands the short form on load, so the map, the panel,
the roll-call and search all see the same shape either way.

Two consequences worth knowing:

- **The directory must be current.** A member whose id is not in
  `data/reference/meps.json` cannot be resolved, so their vote silently disappears from
  the country breakdown. The importer refreshes the directory on every run and the
  validator fails on ballots naming members it does not know.
- **Index size, not disk, is the real ceiling.** A year of votes is about 0.5 MB of
  index; a whole term in one file would be 7 MB, too heavy to load on page open. Chunk
  the index by year before backfilling more than a year.

## Backfilling this Parliament

The current term began on 16 July 2024, after the June 2024 elections. The importer
will not go back past that date unless told to (`--from`), because the previous
Parliament had different members and the directory would not resolve them.

```bash
npm run backfill     # every sitting since 16 July 2024, final votes only
```

That is roughly 600 requests, not 13,500: the portal answers per sitting day — every
decision of that day in one response — not per vote. Add `--all` to include amendment votes, which multiplies the count by about
eight and is worth doing only once the index is chunked.

## What the importer will not do

It writes the vote and nothing else. `summary` and `whatItMeans` are left empty,
because those are editorial work and no script should invent them.

It also cannot write a good headline. The portal titles a vote the way the order paper
does — `Establishment of the digital euro ***I`, or worse,
`C10-0178/2026 – Article 3, § 1, point b – Am 16`. The importer takes the vote item's
title for the record and leaves the decision's own wording as the subtitle, which is
the best a script can honestly do; an editor should rewrite it into something a reader
recognises. That is the standing job after
each plenary: a title, two sentences of summary, and the coverage.

## The Council

There is no equivalent automatic source. The Council publishes its voting results as
documents in its public register rather than as a machine-readable feed, so Council
records are still made by hand from
[the voting results register](https://www.consilium.europa.eu/en/documents-publications/public-register/voting-results/).
That is the next piece of automation worth building, and it is a scraper, not an API
client.
