# Following the plenary automatically

The goal: the day after a plenary session, the site already holds that session's
votes, country by country, without anybody opening a terminal.

## Where the votes come from

Everything comes from the European Parliament itself. No third-party service sits in
between, which means no dependency on somebody else's uptime, rate limits or licence
terms.

| Document | What it gives | Address |
| --- | --- | --- |
| **Roll-call annex** | Every roll-call vote of one sitting, and for each one the name and political group of every member who voted for, against or abstained | `doceo/document/PV-{term}-{date}-RCV_EN.xml`, then `…-RCV_FR.xml`, then `RegData/seance_pleniere/proces_verbal/{year}/{month}-{day}/liste_presence/P{term}_PV({year}){month}-{day}(RCV)_XC.xml` |
| **Votes list** | What the Parliament says happened: adopted, rejected, lapsed, withdrawn — joined to the annex by the roll-call id | `doceo/document/PV-{term}-{date}-VOT_EN.xml` |
| **MEP directory** | Every sitting member with their id, country and national party — this is what turns names into countries | `europarl.europa.eu/meps/en/directory/xml/?leg={term}` |
| **Session calendar** | When each plenary session runs | `europarl.europa.eu/plenary/en/ajax/getSessionCalendar.html?family=PV&termId={term}` |
| **Meeting record** | Whether a session sits in Strasbourg or Brussels (`vcard:hasLocality` ending `FRA_SXB` or `BEL_BRU`) | `data.europarl.europa.eu/api/v1/meetings/MTG-PL-{date}` |

Three of these were worked out by reading
[HowTheyVote.eu's scrapers](https://github.com/HowTheyVote/howtheyvote), which are open
source and have been following these documents for years: the English annex and the
document-register fallback, the votes list as the authority on results, and the session
calendar with its separate location lookup. No code was taken — theirs is AGPL and this
is MIT — but the map of which document holds what is theirs, and it saved a lot of
guessing.

The annex is the primary source because it is the Parliament's own formal record of a
roll call, published with the minutes of the sitting, and it carries every member's
individual vote. Three things follow from how these documents are published:

- **Three addresses, one annex.** English first, because its descriptions become the
  record's titles; French next; then the document register, which sometimes has the
  file before the document server does. The first that answers wins.
- **The result arrives later than the votes.** The annex counts votes but does not say
  what carried. The votes list does, and appears a day or more after the sitting. A
  same-day import derives the result from the totals and says so in its `dataNote`; a
  later run replaces it with the Parliament's own and drops the caveat. This is why the
  schedule re-imports the past week every night.
- **Names are not countries.** The annex identifies members by id and group. The
  directory, cached in `data/reference/meps.json`, turns those into countries.

## Running it by hand

```bash
node scripts/fetch-sessions.mjs                         # the plenary calendar, first
node scripts/fetch-plenary.mjs --date 2026-09-15        # one sitting
node scripts/fetch-plenary.mjs --since 2026-09-01       # every sitting since
node scripts/fetch-plenary.mjs --date 2026-09-15 --all  # amendments as well
node scripts/fetch-plenary.mjs --date 2026-09-15 --dry-run
node scripts/build-index.mjs && node scripts/validate-data.mjs
```

Run the calendar fetch first: with it, the importer only looks at days the Parliament
actually sat, and the site can say when the last session was and where. Without it the
importer falls back to trying weekdays, which costs a 404 each and nothing else.

With no arguments the importer asks for the last seven weekdays, which covers a plenary
that has just finished.

**Only final votes are imported by default.** A plenary produces hundreds of roll
calls, and the overwhelming majority are amendments — importing them all would bury
the decisions that matter under procedural noise. The filter keeps votes on a text as
a whole (*ensemble du texte*, *vote unique*, resolutions, Commission proposals) and
skips anything matching an amendment number. `--all` overrides it. If the filter is
wrong for your purposes, it is two regular expressions at the top of the script.

## Running it on a schedule

`.github/workflows/plenary-sync.yml` follows the publishing rhythm rather than a
generic nightly job:

| When | Why |
| --- | --- |
| Mon–Thu 12:40 UTC | After the midday votes, while the sitting is running |
| Mon–Thu 18:40 UTC | After the evening votes |
| Every night 21:30 UTC | Picks up the votes lists for the past week, replacing derived results with stated ones, and any annex published late |
| Mondays 04:00 UTC | Refreshes the plenary calendar and the member directory |

Each run refreshes the member directory, imports whatever is new, rebuilds the index,
runs the tests and the validator, and commits only if something changed. The Pages
workflow then publishes.

Two settings have to be right for it to work:

1. **Settings → Actions → General → Workflow permissions**: *Read and write*.
   Without this the run imports correctly and then cannot commit.
2. **Settings → Pages**: publishing from `main` via GitHub Actions, so a commit from
   the sync triggers a deploy.

You can also run it from the Actions tab by hand (*Run workflow*), optionally giving a
start date — that is how to backfill a term.

## Verify the first real run before trusting it

This importer was written against the published shape of these documents and tested
against fixtures, **but it has never been run against the live Parliament endpoints**
— the sandbox it was written in has no access to them. Before relying on the schedule,
do one supervised run:

```bash
# 1. Look at what the Parliament actually sends for a sitting you know happened
node scripts/fetch-plenary.mjs --date 2026-09-15 --inspect

# 2. Import it without writing anything
node scripts/fetch-plenary.mjs --date 2026-09-15 --dry-run

# 3. If the counts look right, write it and check it
node scripts/fetch-plenary.mjs --date 2026-09-15
node scripts/build-index.mjs && node scripts/validate-data.mjs
```

`--inspect` prints every tag path in the document with a count. If the element names
have moved, that output tells you exactly what to change, and the mapping is confined
to `parseAnnex` and `parseDirectory` in `scripts/fetch-plenary.mjs`.

Things worth checking on that first run:

- **27 member states**, or an explained shortfall. The importer warns when a member id
  is missing from the directory; `--refresh-meps` usually fixes it.
- **The totals** against the Parliament's own published figures for that vote.
- **Greece**. The Parliament writes it `EL`; this project writes `GR` throughout, and
  the conversion is tested.

## What the importer will not do

It writes the vote and nothing else. `summary`, `whatItMeans`, the impact figures and
the press cards are left empty, because those are editorial work and no script should
invent them.

It also cannot write a good headline. The annex describes a vote as
`A10-0123/2026 - Rapporteur - Proposition de résolution (ensemble du texte)`, which is
a procedural label, not a title. The importer splits it — the object of the vote
becomes the title, the reference and rapporteur become the subtitle — but an editor
should rewrite it into something a reader recognises. That is the standing job after
each plenary: a title, two sentences of summary, and the coverage.

## The Council

There is no equivalent automatic source. The Council publishes its voting results as
documents in its public register rather than as a machine-readable feed, so Council
records are still made by hand from
[the voting results register](https://www.consilium.europa.eu/en/documents-publications/public-register/voting-results/).
That is the next piece of automation worth building, and it is a scraper, not an API
client.
