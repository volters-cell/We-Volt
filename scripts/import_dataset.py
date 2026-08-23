#!/usr/bin/env python3
"""Import real roll-call votes in bulk from the HowTheyVote.eu dataset.

    python3 scripts/import_dataset.py --since 2024-07-16
    python3 scripts/import_dataset.py --since 2024-07-16 --all      # amendments too
    python3 scripts/import_dataset.py --limit 100                   # a slice, for testing

Why this exists alongside scripts/fetch-plenary.mjs: that script reads the
Parliament's own annexes and is how the site keeps up after each sitting, one
day at a time. This one backfills years in a single pass, because the same
material is published as a bulk CSV export at

    https://github.com/HowTheyVote/data/releases/latest

ATTRIBUTION. That export is HowTheyVote.eu's work — they compile it from the
Parliament's documents and publish it for reuse. Anything built on it has to
credit them, and the records this script writes say so in their own `sources`
and `dataNote`. Check their current data licence at howtheyvote.eu/about
before publishing. Records imported by fetch-plenary.mjs from the Parliament's
own annexes carry no such obligation, which is the long-term route.

Votes are written in the compact form: identities live once in
data/reference/meps.json, and each vote stores [member id, position] pairs.
"""

import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict

BASE = "https://github.com/HowTheyVote/data/releases/latest/download"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ("members.csv.gz", "votes.csv.gz", "member_votes.csv.gz")

POSITIONS = {"FOR": 0, "AGAINST": 1, "ABSTENTION": 2, "DID_NOT_VOTE": 3}

# The dataset writes countries with three letters; this project uses two.
ISO3 = {
    "AUT": "AT", "BEL": "BE", "BGR": "BG", "HRV": "HR", "CYP": "CY", "CZE": "CZ",
    "DNK": "DK", "EST": "EE", "FIN": "FI", "FRA": "FR", "DEU": "DE", "GRC": "GR",
    "HUN": "HU", "IRL": "IE", "ITA": "IT", "LVA": "LV", "LTU": "LT", "LUX": "LU",
    "MLT": "MT", "NLD": "NL", "POL": "PL", "PRT": "PT", "ROU": "RO", "SVK": "SK",
    "SVN": "SI", "ESP": "ES", "SWE": "SE",
}

GROUPS = {
    "EPP": "EPP", "PPE": "EPP", "SD": "S&D", "S_D": "S&D", "SANDD": "S&D",
    "PFE": "PfE", "ECR": "ECR", "RENEW": "Renew", "GREEN_EFA": "Greens/EFA",
    "GREENS_EFA": "Greens/EFA", "VERTS_ALE": "Greens/EFA", "LEFT": "The Left",
    "GUE_NGL": "The Left", "ESN": "ESN", "NI": "NI",
}

RESULTS = {"ADOPTED": "adopted", "REJECTED": "rejected", "LAPSED": "lapsed",
           "WITHDRAWN": "withdrawn"}


def cache_path(name):
    return os.path.join(ROOT, ".cache", name)


def fetch(name):
    """Download once, then reuse. The export is ~65 MB; nobody wants it twice."""
    path = cache_path(name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = f"{BASE}/{name}"
    print(f"downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=600) as response, open(path, "wb") as out:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
    return path


def rows(name):
    with gzip.open(fetch(name), "rt", encoding="utf-8", newline="") as handle:
        yield from csv.DictReader(handle)


def slug(value):
    value = unicodedata.normalize("NFD", str(value)).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value[:58]


def group_label(code):
    return GROUPS.get((code or "").upper(), code or "NI")


def title_of(vote):
    """The dataset gives a display title, a procedure title, or a description.
    Prefer whichever actually reads like a title."""
    for key in ("display_title", "procedure_title", "description"):
        text = (vote.get(key) or "").strip()
        if text:
            return re.sub(r"\s+", " ", text)
    return "Roll-call vote"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default="2024-07-16",
                        help="ISO date; defaults to the start of the 2024-2029 term")
    parser.add_argument("--until", default=None)
    parser.add_argument("--all", action="store_true",
                        help="include amendment and procedural votes, not only main votes")
    parser.add_argument("--limit", type=int, default=0, help="import at most this many votes")
    parser.add_argument("--out", default="data/decisions")
    args = parser.parse_args()

    # 1. Which votes are we importing?
    wanted = []
    for vote in rows("votes.csv.gz"):
        stamp = vote["timestamp"]
        if stamp < args.since:
            continue
        if args.until and stamp[:10] > args.until:
            continue
        if not args.all and vote.get("is_main") != "True":
            continue
        wanted.append(vote)

    wanted.sort(key=lambda v: v["timestamp"])
    if args.limit:
        wanted = wanted[-args.limit:]
    ids = {v["id"] for v in wanted}
    print(f"{len(wanted)} votes to import "
          f"({wanted[0]['timestamp'][:10]} to {wanted[-1]['timestamp'][:10]})", file=sys.stderr)

    # 2. Every ballot cast in those votes, and who was sitting when.
    ballots = defaultdict(list)
    seen_members = {}
    for i, row in enumerate(rows("member_votes.csv.gz"), 1):
        if i % 4_000_000 == 0:
            print(f"  read {i:,} ballots", file=sys.stderr)
        if row["vote_id"] not in ids:
            continue
        position = POSITIONS.get(row["position"])
        if position is None:
            continue
        member = int(row["member_id"])
        ballots[row["vote_id"]].append([member, position])
        seen_members[member] = (row["country_code"], row["group_code"])

    print(f"  kept {sum(len(b) for b in ballots.values()):,} ballots "
          f"for {len(ballots)} votes", file=sys.stderr)

    # 3. The member directory: names from members.csv, country and group from
    #    the votes themselves, so a member who changed group is recorded as they
    #    sat most recently.
    directory = {}
    for member in rows("members.csv.gz"):
        key = int(member["id"])
        if key not in seen_members:
            continue
        country_code, group_code = seen_members[key]
        country = ISO3.get((country_code or "").upper())
        if not country:
            continue
        first = (member.get("first_name") or "").strip()
        last = (member.get("last_name") or "").strip()
        directory[str(key)] = {
            "name": f"{first} {last}".strip(),
            "country": country,
            "group": group_label(group_code),
            "party": None,
        }

    missing = sorted(set(seen_members) - {int(k) for k in directory})
    if missing:
        print(f"  {len(missing)} members voted but are not in members.csv", file=sys.stderr)

    with open(os.path.join(ROOT, "data/reference/meps.json"), "w", encoding="utf-8") as out:
        json.dump({
            "source": "https://github.com/HowTheyVote/data — compiled by HowTheyVote.eu "
                      "from the European Parliament's roll-call annexes",
            "fetched": None,
            "term": 10,
            "note": "Identities are stored here once. Vote records reference members by id, "
                    "which is what keeps a full term of roll-calls at tens of megabytes.",
            "members": directory,
        }, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(f"data/reference/meps.json — {len(directory)} members", file=sys.stderr)

    # 4. One file per vote.
    out_dir = os.path.join(ROOT, args.out)
    os.makedirs(out_dir, exist_ok=True)
    written = 0
    for vote in wanted:
        cast = ballots.get(vote["id"])
        if not cast:
            continue
        date = vote["timestamp"][:10]
        reference = (vote.get("procedure_reference") or "").strip()
        title = title_of(vote)
        result = RESULTS.get((vote.get("result") or "").upper(), "recorded")
        counts = {key: int(vote.get(f"count_{key}") or 0)
                  for key in ("for", "against", "abstention", "did_not_vote")}

        decision = {
            "id": f"ep-{date}-{slug(reference or title)}-{vote['id']}",
            "sourceId": int(vote["id"]),
            "status": "verified",
            "dataNote": "Roll-call vote of the European Parliament, imported from the "
                        "HowTheyVote.eu dataset, which compiles the Parliament's own "
                        "roll-call annexes. Summary and press sections are editorial and "
                        "left empty.",
            "body": "parliament",
            "bodyLabel": "European Parliament",
            "title": title,
            "subtitle": (f"{reference} — " if reference else "") + "roll-call vote in plenary",
            "date": date,
            "voteRule": "simple-majority",
            "voteRuleLabel": "Majority of votes cast",
            "procedure": {"reference": reference or None, "url": None},
            "summary": (vote.get("description") or "").strip(),
            "whatItMeans": [],
            "outcome": {
                "result": result,
                "headline": (
                    f"{result.capitalize()} — {counts['for']} in favour, "
                    f"{counts['against']} against, {counts['abstention']} abstained."
                ),
            },
            "impactUnit": "EUR per person per year",
            "impactLabel": "Estimated net budget effect",
            "ballots": sorted(cast),
            "sources": [
                {"label": "HowTheyVote.eu dataset",
                 "url": "https://github.com/HowTheyVote/data/releases/latest"},
                {"label": "Roll-call annex to the minutes",
                 "url": "https://www.europarl.europa.eu/doceo/document/"},
            ],
            "countries": {},
        }

        # Written compactly: these are machine-generated by the hundred, nobody
        # reads the diffs, and the indentation would triple the repository.
        with open(os.path.join(out_dir, decision["id"] + ".json"), "w", encoding="utf-8") as out:
            json.dump(decision, out, ensure_ascii=False, separators=(",", ":"))
            out.write("\n")
        written += 1

    print(f"{written} vote records written to {args.out}", file=sys.stderr)
    print("Next: node scripts/build-index.mjs && node scripts/validate-data.mjs", file=sys.stderr)


if __name__ == "__main__":
    main()
