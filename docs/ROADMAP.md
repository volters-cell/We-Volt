# Roadmap

Where the project is, and what it would take to make it a working newsroom tool
across 27 countries.

## Now — the prototype in this repository

- The map: EU-27, projected the way the EU projects its own maps, keyboard-navigable,
  56 KB of geometry and no tile server.
- The vote laid over the map: how every member state, every political group and every
  member voted, on any record.
- Council qualified-majority arithmetic computed live, including whether a blocking
  minority formed.
- Parliament records down to the individual MEP, imported from published roll-calls.
- Permalinks to any country's record on any decision.
- The whole of this parliamentary term imported from the Parliament's open data
  portal, checked vote by vote against it by a monthly audit.

## Next — what makes it usable by a journalist on deadline

1. **A real archive.** One import run per plenary session, so the site holds every
   roll-call of the term rather than three files. The importer already exists; it
   needs a schedule and a review step.
2. **Search across decisions.** "Show me every vote where my country's delegation was
   split", "every decision where Ireland and Denmark diverged". This is the query no
   existing tool answers, and the data model already supports it.
3. **Country view.** The mirror of the current view: one member state, every decision,
   its record across the term.
4. **Embeds.** A single decision map as an `<iframe>` a newsroom can drop into an
   article, with attribution baked in. This is the distribution mechanism — most
   readers will meet the project inside somebody else's story.
5. **Multilingual interface.** Interface strings first (they are few and static), then
   summaries in the 24 official languages. The Parliament publishes its own titles in
   all of them, which is the starting point.

## Later — what makes it a network rather than a website

6. **Plain-language summaries.** The Parliament titles a vote the way the order paper
   does. Turning that into a sentence a reader recognises is editorial work, and it is
   what stands between a record and a story. One editor per session would do it.
7. **National parties.** A member's country and group are here; the party they were
   elected for is not, because the portal records it as an organisation number rather
   than a name. Resolving those numbers would let any party be followed as a bloc, the
   way Volt already is.
8. **Outermost regions inset.** The Azores, Madeira, the Canaries and the French
   overseas departments are member-state territory and currently off the map.
9. **Accessibility audit.** Keyboard navigation and colour contrast were built in from
   the start; an audit against WCAG 2.2 AA with actual screen-reader users is the
   test that matters.
10. **Data API.** The JSON files are already the API. Documenting them and versioning
    them makes other people's projects possible.

## Funding fit — Creative Europe

The natural home is the **Journalism Partnerships** strand of Creative Europe's
cross-sectoral programme, which funds cross-border collaboration between newsrooms and
projects that strengthen media pluralism and access to trustworthy news. Check the
current call text, budget and deadlines on the EU Funding & Tenders portal before
writing anything — the strand's details change between calls, and nothing in this
document should be treated as a substitute for the call itself.

What this project can put in an application that most cannot:

- **A working prototype, not a concept.** The repository runs. A reviewer can open the
  map, click a country and see the output, in the same session in which they read the
  application.
- **Genuinely cross-border by construction.** The product does not work with one
  country in it. Its value comes from the comparison — the same vote, 27 delegations,
  eight political groups — which is the exact thing the strand exists to fund.
- **A defined role for partner newsrooms.** Partners are not audiences here: they get
  a per-vote record they can embed, cite and check against the Parliament's own.
- **Multilingualism as a feature, not a translation cost.** The Parliament publishes
  every vote's title in all 24 official languages; the interface is the only part that
  needs writing.
- **Open outputs.** Code MIT, data CC BY, no lock-in, and everything survives the end
  of the grant because the site is static files.
- **Measurable outcomes.** Votes covered against the Parliament's own count — a figure
  the monthly audit produces rather than a claim — embeds placed in partner outlets,
  and summaries written.

The honest weaknesses to prepare answers for: 115 of the votes still have no
plain-language summary, and writing them is human work that a budget has to pay for;
national parties are missing until the portal's organisation numbers are resolved; and
the cost layer needs a published methodology and named reviewers before anyone should
rely on a figure in it.
