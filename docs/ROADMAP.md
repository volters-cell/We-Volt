# Roadmap

The current state of the project and the work planned next.

## Now — the prototype in this repository

- The map: EU-27, projected the way the EU projects its own maps, keyboard-navigable,
  96 KB of geometry and no tile server.
- The vote laid over the map: how every member state, every political group and every
  member voted, on any record.
- Council qualified-majority arithmetic computed live, including whether a blocking
  minority formed.
- Parliament records down to the individual MEP, imported from the published ballots.
- Permalinks to any country's record on any decision.
- The whole of this parliamentary term imported from the Parliament's open data
  portal, checked vote by vote against it by a monthly audit.

## Next

1. **A real archive.** One import run per plenary session, so the site holds every
   vote of the term rather than three files. The importer already exists; it
   needs a schedule and a review step.
2. **Search across decisions.** Queries across the whole term rather than within one
   vote — for example, votes where a delegation split, or where two member states
   diverged. The data model already supports it.
3. **Country view.** The mirror of the current view: one member state, every decision,
   its record across the term.
4. **Embeds.** A single decision map as an `<iframe>` that can be placed in an
   article, with attribution included.
5. **Multilingual interface.** Interface strings first (they are few and static), then
   summaries in the 24 official languages. The Parliament publishes its own titles in
   all of them, which is the starting point.

## Later

6. **Plain-language summaries.** The Parliament titles a vote as the order paper does.
   Rewriting those titles in plain language is editorial work and is done by hand.
7. **National parties.** A member's country and group are here; the party they were
   elected for is not, because the portal records it as an organisation number rather
   than a name. Resolving those numbers would let any party be followed as a bloc, the
   way Volt already is.
8. **Outermost regions inset.** The Azores, Madeira, the Canaries and the French
   overseas departments are member-state territory and currently off the map.
9. **Accessibility audit.** Keyboard navigation and colour contrast were built in from
   the start; the next step is an audit against WCAG 2.2 AA, including testing with
   screen-reader users.
10. **Data API.** The JSON files are already the interface. The work is to document
    and version them so other projects can depend on them.

## Funding

The project is aimed at the **Journalism Partnerships** strand of Creative Europe's
cross-sectoral programme, which supports cross-border collaboration between newsrooms
and projects concerned with media pluralism and access to news. Call text, budget and
deadlines are published on the EU Funding & Tenders portal and change between calls;
this document is not a substitute for the call itself.

What the repository currently provides:

- A working prototype that can be opened and used as it stands.
- Coverage of all 27 member states from a single source, so the same vote can be
  compared across delegations and political groups.
- Per-vote records that can be embedded, cited and checked against the Parliament's
  published data.
- Vote titles available in all 24 official languages from the source; only the
  interface strings need translating.
- Open licensing: code under MIT, data authored here under CC BY 4.0, imported records
  under the terms of their source. The site is static files and does not depend on a
  running service.
- Coverage measured against the Parliament's own count by the audit script rather than
  asserted.

Current limitations: 115 votes have no plain-language summary, and writing them is
manual work; national parties are not resolved until the portal's organisation numbers
are mapped; and the cost layer requires a published methodology and review before any
figure in it is used.
