# Political group logos

Each political group's own mark, as the group publishes it, used to identify
that group wherever it appears: the breakdown of a vote, the group table in a
country's panel, and a member's own record.

## Where they came from

Not from the Parliament. Ten of its pages were surveyed for them — every member
page, the members' directory and its advanced search, the page on the political
groups, the plenary's page on them, the topic page, and the election results
site — and between them they carry members' portraits, the Parliament's own
emblem, and interface icons. It does not publish the groups' marks in any
format.

So each mark comes from that group's own site, out of its own header, and
`sources.json` records the exact address each file was taken from and the page
it was found on. `scripts/mirror-group-logos.mjs` does the fetching; run it
through the "The groups' marks" workflow, `probe` first — it prints what it
found on each site and the score it gave each candidate, and writes nothing.
That probe is not a formality: it has caught a company that merely shared a
group's initials, a faded watermark being taken for a logo, and a hero
photograph winning for want of anything better.

The non-attached members are not a group and have no mark. They keep a
lettered tile, as does any group whose mark has not been found.

The EPP is the one group whose mark could not be taken. Its header holds an
empty div named `logo-eppfull` and fills it in from its own script bundle, so
the mark is in none of the places a page can be asked about it — not an image,
a background, a mask, a pseudo-element, `content: url()`, an inline drawing,
nor the network traffic. Left to itself the scoring would then settle on the
best of what remains, which is an article photograph, so `CANNOT` in the script
stops it: the EPP keeps its lettered tile rather than wearing a stock picture.

## How they are drawn

A mark sits on a light tile in both themes, because it is drawn for the paper
its group prints it on and not for whichever theme a reader is using. A mark
published only in white keeps its group's own colour behind it instead — that
is the field that version is made for. Which marks are white was measured from
the files, not guessed; `WHITE_INK` in `assets/js/groups.js` holds the answer,
and it should be re-measured after a re-fetch.

Nothing is recoloured, cropped or redrawn. If a file will not work at the size
it is shown, the lettered tile is the better answer.

`assets/js/groups.js` holds the names, the fallback colours and the swap, so a
group looks the same wherever a reader meets it. `logos.json` lists which files
exist — `node scripts/build-index.mjs` rewrites it — so a group with no mark
costs no failed request.

## On using them

These are the groups' own trademarks. Using a mark to identify the thing it
belongs to — which is exactly what a row labelled "Renew Europe" does — is the
ordinary, nominative use of a mark, and every file here records where it came
from so the question always has an answer. The about page says the same in
public.

The tile colours in `assets/js/groups.js` are the conventional ones used for
these groups in seat charts. They are approximations, not official values, and
they are in one place so they can be corrected.
