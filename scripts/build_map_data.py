#!/usr/bin/env python3
"""Build the outline the map draws.

Input : a Natural Earth derived GeoJSON of Europe (WGS84 lon/lat).
Output: data/eu-countries.geo.json — the 27 member states, plus their
        neighbours as context, Douglas-Peucker simplified and rounded.

Member states carry properties.member = true and are the interactive part of
the map. Neighbours carry member = false: they are drawn in grey behind
everything, unlabelled and unclickable, because a Union floating in a white
void reads as a diagram rather than a map. The viewBox is fitted to the member
states alone, so the neighbours simply run off the edge, as they do on any map.

Usage: python3 scripts/build_map_data.py europe.geojson data/eu-countries.geo.json
"""
import json
import math
import sys

# EU-27 as of 2020 (post-Brexit). Keyed by the source file's NAME field.
EU27 = {
    "Austria": ("AT", "Austria"),
    "Belgium": ("BE", "Belgium"),
    "Bulgaria": ("BG", "Bulgaria"),
    "Croatia": ("HR", "Croatia"),
    "Cyprus": ("CY", "Cyprus"),
    "Czech Republic": ("CZ", "Czechia"),
    "Denmark": ("DK", "Denmark"),
    "Estonia": ("EE", "Estonia"),
    "Finland": ("FI", "Finland"),
    "France": ("FR", "France"),
    "Germany": ("DE", "Germany"),
    "Greece": ("GR", "Greece"),
    "Hungary": ("HU", "Hungary"),
    "Ireland": ("IE", "Ireland"),
    "Italy": ("IT", "Italy"),
    "Latvia": ("LV", "Latvia"),
    "Lithuania": ("LT", "Lithuania"),
    "Luxembourg": ("LU", "Luxembourg"),
    "Malta": ("MT", "Malta"),
    "Netherlands": ("NL", "Netherlands"),
    "Poland": ("PL", "Poland"),
    "Portugal": ("PT", "Portugal"),
    "Romania": ("RO", "Romania"),
    "Slovakia": ("SK", "Slovakia"),
    "Slovenia": ("SI", "Slovenia"),
    "Spain": ("ES", "Spain"),
    "Sweden": ("SE", "Sweden"),
}

# Every European country that is not in the Union, drawn in grey. The list
# follows the Council of Europe's geography rather than a strict continental
# line, which is why the South Caucasus is here: those states sit in European
# institutions, and a reader looking for them should find them.
NEIGHBOURS = {
    "Albania": ("AL", "Albania"),
    "Andorra": ("AD", "Andorra"),
    "Armenia": ("AM", "Armenia"),
    "Azerbaijan": ("AZ", "Azerbaijan"),
    "Belarus": ("BY", "Belarus"),
    "Bosnia and Herzegovina": ("BA", "Bosnia and Herzegovina"),
    "Faroe Islands": ("FO", "Faroe Islands"),
    "Georgia": ("GE", "Georgia"),
    "Holy See (Vatican City)": ("VA", "Vatican City"),
    "Iceland": ("IS", "Iceland"),
    "Liechtenstein": ("LI", "Liechtenstein"),
    "Monaco": ("MC", "Monaco"),
    "Montenegro": ("ME", "Montenegro"),
    "Norway": ("NO", "Norway"),
    "Republic of Moldova": ("MD", "Moldova"),
    "Russia": ("RU", "Russia"),
    "San Marino": ("SM", "San Marino"),
    "Serbia": ("RS", "Serbia"),
    "Switzerland": ("CH", "Switzerland"),
    "The former Yugoslav Republic of Macedonia": ("MK", "North Macedonia"),
    "Turkey": ("TR", "Türkiye"),
    "Ukraine": ("UA", "Ukraine"),
    "United Kingdom": ("GB", "United Kingdom"),
}

# Neighbours are kept over a wider window than the member states, because the
# viewBox crops them anyway and a country cut off at the frame looks right
# where a country missing entirely looks broken.
NEIGHBOUR_BBOX = (-25.0, 30.0, 45.0, 75.0)
NEIGHBOUR_EPSILON = 0.07   # coarser: nobody reads a coastline that is context
NEIGHBOUR_MIN_AREA = 0.8
NEIGHBOUR_PRECISION = 2

# Map window: continental Europe plus Cyprus and Malta. Overseas territories
# (Azores, Madeira, Canaries, French overseas departments) fall outside and are
# dropped from the outline — they are still part of the member states, and the
# roadmap covers giving them their own inset.
BBOX = (-13.0, 33.0, 34.5, 71.5)  # min lon, min lat, max lon, max lat

MIN_AREA = 0.35   # square degrees; keeps Sicily, Sardinia, Crete, Gotland...
EPSILON = 0.035   # Douglas-Peucker tolerance in degrees
PRECISION = 3


def ring_area(ring):
    """Unsigned shoelace area of a lon/lat ring, in square degrees."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def in_bbox(ring, bbox=BBOX):
    min_lon, min_lat, max_lon, max_lat = bbox
    return any(min_lon <= x <= max_lon and min_lat <= y <= max_lat for x, y in ring)


def perpendicular_distance(pt, start, end):
    (x, y), (x1, y1), (x2, y2) = pt, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def simplify(points, epsilon):
    """Iterative Douglas-Peucker (recursion would blow the stack on Norway-sized rings)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        worst, worst_index = 0.0, first
        for i in range(first + 1, last):
            d = perpendicular_distance(points[i], points[first], points[last])
            if d > worst:
                worst, worst_index = d, i
        if worst > epsilon:
            keep[worst_index] = True
            stack.append((first, worst_index))
            stack.append((worst_index, last))
    return [p for p, k in zip(points, keep) if k]


def clean_ring(ring, epsilon, precision=PRECISION):
    simplified = simplify([tuple(p[:2]) for p in ring], epsilon)
    if len(simplified) < 4:
        return None
    rounded = [[round(x, precision), round(y, precision)] for x, y in simplified]
    if rounded[0] != rounded[-1]:
        rounded.append(list(rounded[0]))
    # rounding can collapse neighbouring vertices onto each other
    deduped = [rounded[0]]
    for point in rounded[1:]:
        if point != deduped[-1]:
            deduped.append(point)
    return deduped if len(deduped) >= 4 else None


def polygons_of(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError("unexpected geometry: " + geometry["type"])


def build_neighbour(source):
    """A neighbour needs a recognisable silhouette and nothing more."""
    code, name = NEIGHBOURS[source["properties"]["NAME"]]
    candidates = [p[0] for p in polygons_of(source["geometry"]) if in_bbox(p[0], NEIGHBOUR_BBOX)]
    candidates.sort(key=ring_area, reverse=True)
    if not candidates:
        return None

    # Same rule as for member states: the mainland is always kept, however
    # small, so San Marino and Monaco survive being a fraction of a pixel.
    keepers = candidates[:1] + [r for r in candidates[1:] if ring_area(r) >= NEIGHBOUR_MIN_AREA]
    kept = []
    for outer in keepers:
        epsilon = min(NEIGHBOUR_EPSILON, math.sqrt(ring_area(outer)) / 12)
        precision = NEIGHBOUR_PRECISION if ring_area(outer) > 1 else PRECISION
        ring = clean_ring(outer, epsilon, precision)
        if ring:
            kept.append([ring])
    if not kept:
        return None
    return {
        "type": "Feature",
        "id": code,
        "properties": {"code": code, "name": name, "member": False},
        "geometry": {"type": "MultiPolygon", "coordinates": kept},
    }


def build_feature(source):
    code, name = EU27[source["properties"]["NAME"]]
    candidates = [p[0] for p in polygons_of(source["geometry"]) if in_bbox(p[0])]
    candidates.sort(key=ring_area, reverse=True)
    if not candidates:
        return None
    # The mainland is always kept, however small: Malta and Luxembourg are
    # member states with a seat at the table like everyone else.
    keepers = candidates[:1] + [r for r in candidates[1:] if ring_area(r) >= MIN_AREA]
    kept = []
    for outer in keepers:
        # Small countries need a finer tolerance or simplification eats them.
        epsilon = min(EPSILON, math.sqrt(ring_area(outer)) / 12)
        ring = clean_ring(outer, epsilon)
        if ring:
            kept.append([ring])  # holes are irrelevant at this scale
    if not kept:
        return None
    return {
        "type": "Feature",
        "id": code,
        "properties": {"code": code, "name": name, "member": True},
        "geometry": {"type": "MultiPolygon", "coordinates": kept},
    }


def main(src_path, out_path):
    source = json.load(open(src_path, encoding="utf-8"))
    features = []
    context = []
    for feature in source["features"]:
        name = feature["properties"].get("NAME")
        if name in EU27:
            built = build_feature(feature)
            if built:
                features.append(built)
        elif name in NEIGHBOURS:
            built = build_neighbour(feature)
            if built:
                context.append(built)
    features.sort(key=lambda f: f["id"])
    context.sort(key=lambda f: f["id"])
    missing = {code for code, _ in EU27.values()} - {f["id"] for f in features}
    if missing:
        raise SystemExit("missing member states: " + ", ".join(sorted(missing)))
    out = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Natural Earth / TM World Borders, public domain",
            "note": "Simplified for display only. Not for legal or cartographic use.",
        },
        # Neighbours first: the drawing order is the stacking order, and the
        # member states have to sit on top of them.
        "features": context + features,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(",", ":"))
    count = lambda group: sum(len(r) for f in group for p in f["geometry"]["coordinates"] for r in p)
    print(f"{len(features)} member states ({count(features)} points), "
          f"{len(context)} neighbours ({count(context)} points) -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
