#!/usr/bin/env python3
"""Build the simplified EU-27 outline used by the map.

Input : a Natural Earth derived GeoJSON of Europe (WGS84 lon/lat).
Output: data/eu-countries.geo.json — EU-27 only, small polygons dropped,
        Douglas-Peucker simplified, coordinates rounded to 3 decimals.

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


def in_bbox(ring):
    min_lon, min_lat, max_lon, max_lat = BBOX
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


def clean_ring(ring, epsilon):
    simplified = simplify([tuple(p[:2]) for p in ring], epsilon)
    if len(simplified) < 4:
        return None
    rounded = [[round(x, PRECISION), round(y, PRECISION)] for x, y in simplified]
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
        "properties": {"code": code, "name": name},
        "geometry": {"type": "MultiPolygon", "coordinates": kept},
    }


def main(src_path, out_path):
    source = json.load(open(src_path, encoding="utf-8"))
    features = []
    for feature in source["features"]:
        if feature["properties"].get("NAME") in EU27:
            built = build_feature(feature)
            if built:
                features.append(built)
    features.sort(key=lambda f: f["id"])
    missing = {code for code, _ in EU27.values()} - {f["id"] for f in features}
    if missing:
        raise SystemExit("missing member states: " + ", ".join(sorted(missing)))
    out = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Natural Earth / TM World Borders, public domain",
            "note": "Simplified for display only. Not for legal or cartographic use.",
        },
        "features": features,
    }
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(out, handle, ensure_ascii=False, separators=(",", ":"))
    points = sum(len(r) for f in features for p in f["geometry"]["coordinates"] for r in p)
    print(f"{len(features)} member states, {points} points -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
