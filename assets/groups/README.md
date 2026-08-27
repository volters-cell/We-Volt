# Political group logos

Drop a file here named after the group and the site uses it in place of the
coloured mark — everywhere that group appears: the roll-call breakdown, and the
group table in a country's panel. Nine files cover the whole Parliament:

```
assets/groups/epp.svg
assets/groups/s-d.svg
assets/groups/pfe.svg
assets/groups/ecr.svg
assets/groups/renew.svg
assets/groups/greens-efa.svg
assets/groups/the-left.svg
assets/groups/esn.svg
assets/groups/ni.svg
```

The name is the group's abbreviation, lowercased, with anything that is not a
letter or a digit turned into a hyphen — the same slug the code builds, so
`Greens/EFA` becomes `greens-efa`. SVG is preferred; PNG works. Square artwork
sits best; anything else is fitted inside the tile without being stretched.

After adding one, run `node scripts/build-index.mjs` — it rewrites `logos.json`,
the list of files that exist. The page reads that list rather than guessing, so
a group with no logo costs no failed request.

Nothing breaks if a file is absent: that group keeps its coloured mark, and the
two styles sit together happily while you collect the set. The names, the
colours and the swap all live in `assets/js/groups.js`, so a group looks the
same wherever a reader meets it.

## Before you add them

These are the groups' own trademarks. Using a mark to identify the thing it
belongs to — which is exactly what a row labelled "European People's Party"
does — is normally defensible, but it is not a licence, and a publicly funded
project should be able to say where each file came from:

- Take the artwork from the group's own site or press kit, not from another
  site that has already reprocessed it.
- Check the terms on that page. Some groups publish brand guidelines that say
  what is allowed.
- Do not recolour, crop or redraw a mark. If artwork will not work at 48 pixels
  square, the coloured tile is the better answer.

The tile colours in `assets/js/app.js` are the conventional ones used for these
groups in seat charts. They are approximations, not official values, and they
are in one place so they can be corrected.
