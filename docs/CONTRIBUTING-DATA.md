# Filing a country's record

You do not need to know JavaScript to contribute to EU Tracker. You need to know one
country's politics and one country's press. That is the part no scraper can do.

## What a press entry is for

The point is not to collect links. It is to show a reader in Lisbon how the same vote
was explained in Warsaw, and to make it obvious when a decision that dominated one
country's front pages went unreported in another.

So: **two to four items per country, chosen to represent the coverage**, not the four
you happen to agree with. If the national conversation was one-sided, the entries
should be one-sided and the map will say *critical* or *supportive* honestly. If it
was contested, show the contest.

```jsonc
{
  "outlet": "Gazeta Przykładowa",
  "headline": "The headline as published, in the original language",
  "excerpt": "One or two sentences, quoted fairly and attributably.",
  "framing": "critical",
  "language": "pl",
  "date": "2026-05-28",
  "url": "https://…"
}
```

### Choosing the framing tag

The tag describes **how the outlet framed the decision**, not whether the outlet is
right, and not the newspaper's general politics.

| Tag | Use it when the piece |
| --- | --- |
| `supportive` | presents the decision as a gain, a solution, or overdue |
| `critical` | presents it as a cost, an imposition, or a failure |
| `mixed` | gives both readings real weight, or splits gain and cost between groups |
| `neutral` | reports what happened without a frame — wires, briefs, records |

A commentary hostile to the *government's* position but supportive of the decision is
`supportive`. When two editors disagree about a tag, `mixed` is usually the honest
answer.

### Fairness rules

- Quote briefly and attribute plainly. Excerpts are for orientation, not
  republication.
- Link to the original, not to an aggregator.
- Translate the excerpt if you like, but keep the headline in its own language — the
  `language` tag tells the interface what it is looking at.
- Do not file a paywalled article without a summary a reader can use.
- Do not file your own outlet's coverage exclusively.

## Cost and benefit figures

An impact figure needs three things: a number, the unit the decision uses, and a note
saying what it measures. Without the note, the validator rejects it, because
"−19.6 EUR per person" means nothing on its own — is it a one-off, a yearly cost, net
or gross of EU co-financing?

Prefer, in order: the institution's own impact assessment; a national ministry or
audit office; a named research institute. If the only figure available is contested,
say so in the note and give the range.

## Corrections

A record that turns out to be wrong is corrected in the file, in a pull request, with
the correction visible in the git history. Nothing is quietly edited. If a press
outlet updates a headline, add the new one rather than replacing the old.

## Submitting

1. Fork, branch, edit the country entry in `data/decisions/<id>.json`.
2. `npm test`.
3. Open a pull request describing which country you filed and where the figures came
   from.

Editors from a member state have the final word on their own country's entries. If you
are filing for a country you do not report on, say so in the pull request.
