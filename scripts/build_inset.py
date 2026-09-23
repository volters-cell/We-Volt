#!/usr/bin/env python3
"""Add Atlantic Canada to the map, as an inset.

Canada has said it wants to be more closely associated with the European
Union, and a map of the Union with Canada's intention on it should be able to
show where Canada is. But Newfoundland is forty degrees of longitude west of
Ireland. Fitting the frame around it would push the whole of Europe into the
right-hand third of the picture — every member state smaller, and the whole
point of the map is the member states.

So Canada goes where maps put a place that matters and does not fit: in an
inset. Only its Atlantic edge — Newfoundland, the Labrador coast, the
Maritimes, the Gaspe — which is the part of Canada that faces Europe, in the
empty ocean at the left of the frame, between Iceland and Ireland. That is
roughly where it would be if the Atlantic were narrower: Newfoundland is on
the latitude of France. It is drawn in its own box, with its own projection
centred on itself, and it takes no part in fitting the frame, so the member
states keep exactly the size they had.

Source: Natural Earth 1:50m admin-0 countries, public domain.
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

Usage: python3 scripts/build_inset.py ne_50m_admin_0_countries.geojson data/eu-countries.geo.json
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from build_map_data import clean_ring, ring_area  # noqa: E402  same rules as every neighbour

# The Atlantic edge of Canada, and nothing inland: a little piece, which is
# what it is on the map for.
WINDOW = (-67.0, 43.3, -52.5, 55.0)   # min lon, min lat, max lon, max lat
EPSILON = 0.05
PRECISION = 2
MIN_AREA = 0.15   # square degrees: Newfoundland, Cape Breton, PEI, Anticosti

# Where the inset sits, as fractions of the frame, so it lands in the same
# place whatever size the map is drawn at. Measured against the drawn map, not
# guessed: the left of the frame is open Atlantic from below Iceland to above
# Ireland, and Scotland is the nearest land to the right.
INSET = {
    "centre": [-59.5, 49.0],
    "box": [0.018, 0.214, 0.121, 0.157],
}


def clip(ring, window):
    """Sutherland-Hodgman against a lon/lat rectangle.

    The mainland of Canada runs from the Pacific to the Atlantic; this keeps
    the part of it inside the window and closes the cut along the window's
    edge, which inside an inset reads as the edge of the inset.
    """
    min_x, min_y, max_x, max_y = window
    edges = [
        (lambda p: p[0] >= min_x, lambda a, b: cut_x(a, b, min_x)),
        (lambda p: p[0] <= max_x, lambda a, b: cut_x(a, b, max_x)),
        (lambda p: p[1] >= min_y, lambda a, b: cut_y(a, b, min_y)),
        (lambda p: p[1] <= max_y, lambda a, b: cut_y(a, b, max_y)),
    ]
    points = [tuple(p[:2]) for p in ring]
    for inside, cross in edges:
        if not points:
            break
        kept = []
        previous = points[-1]
        for current in points:
            if inside(current):
                if not inside(previous):
                    kept.append(cross(previous, current))
                kept.append(current)
            elif inside(previous):
                kept.append(cross(previous, current))
            previous = current
        points = kept
    if len(points) < 3:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    return points


def cut_x(a, b, x):
    t = (x - a[0]) / (b[0] - a[0])
    return (x, a[1] + t * (b[1] - a[1]))


def cut_y(a, b, y):
    t = (y - a[1]) / (b[1] - a[1])
    return (a[0] + t * (b[0] - a[0]), y)


def main(source_path, out_path):
    source = json.load(open(source_path))
    canada = next(f for f in source["features"]
                  if f["properties"].get("ADMIN") == "Canada")
    geometry = canada["geometry"]
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" \
        else [geometry["coordinates"]]

    kept = []
    for polygon in polygons:
        clipped = clip(polygon[0], WINDOW)
        if not clipped or ring_area(clipped) < MIN_AREA:
            continue
        ring = clean_ring(clipped, EPSILON, PRECISION)
        if ring:
            kept.append([ring])

    if not kept:
        sys.exit("Nothing of Canada inside the window: check WINDOW.")

    feature = {
        "type": "Feature",
        "id": "CA",
        "properties": {
            "code": "CA",
            "name": "Canada",
            "member": False,
            "inset": INSET,
            "note": ("Atlantic Canada, drawn in an inset. Not to scale with, and not "
                     "in its true position relative to, the rest of the map."),
        },
        "geometry": {"type": "MultiPolygon", "coordinates": kept},
    }

    out = json.load(open(out_path))
    out["features"] = [f for f in out["features"] if f["properties"].get("code") != "CA"]
    out["features"].append(feature)
    with open(out_path, "w") as handle:
        json.dump(out, handle, separators=(",", ":"))
        handle.write("\n")

    points = sum(len(p[0]) for p in kept)
    print(f"Canada: {len(kept)} polygons, {points} points, inset at {INSET['box']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
