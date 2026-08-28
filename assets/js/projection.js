/* Lambert azimuthal equal-area, the projection the EU uses for its own maps
   (ETRS89-LAEA, EPSG:3035: centred on 52N 10E). Spherical form — the flattening
   error is far below the simplification already baked into the outlines. */
(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const LAT0 = 52 * RAD;
  const LON0 = 10 * RAD;
  const SIN_LAT0 = Math.sin(LAT0);
  const COS_LAT0 = Math.cos(LAT0);

  function project(lon, lat) {
    const phi = lat * RAD;
    const lambda = lon * RAD - LON0;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosLambda = Math.cos(lambda);
    const denominator = 1 + SIN_LAT0 * sinPhi + COS_LAT0 * cosPhi * cosLambda;
    const k = Math.sqrt(2 / Math.max(denominator, 1e-9));
    return [
      k * cosPhi * Math.sin(lambda),
      -k * (COS_LAT0 * sinPhi - SIN_LAT0 * cosPhi * cosLambda) // SVG y grows downward
    ];
  }


  /* The centroid of Croatia is in Bosnia, and the centroid of Denmark is in the
     sea. What a label wants is the point furthest inside the shape — the pole of
     inaccessibility — found here by a grid search with one refinement pass. */
  function pointInRing(x, y, ring) {
    // Winding number, not crossing count: simplification can leave a coastline
    // crossing itself, and the two rules disagree exactly there. The browser
    // fills by winding, so the label search has to agree with it.
    let winding = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = ring[i][0], ay = ring[i][1];
      const bx = ring[i + 1][0], by = ring[i + 1][1];
      const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y) {
        if (by > y && side > 0) winding += 1;
      } else if (by <= y && side < 0) {
        winding -= 1;
      }
    }
    return winding !== 0;
  }

  function distanceToRing(x, y, ring) {
    let best = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = ring[i][0], ay = ring[i][1];
      const bx = ring[i + 1][0], by = ring[i + 1][1];
      const dx = bx - ax, dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      let t = lengthSquared ? ((x - ax) * dx + (y - ay) * dy) / lengthSquared : 0;
      t = Math.max(0, Math.min(1, t));
      const distance = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (distance < best) best = distance;
    }
    return best;
  }

  /* The centre of area of a ring — where the shape balances. It reads as the
     middle of a country to anyone looking at it, which the pole of
     inaccessibility does not always: Germany's widest inscribed circle sits
     out west in Hesse, because the country narrows towards Bavaria and the
     northern coast is full of bites. */
  function areaCentroid(ring) {
    let twiceArea = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = ring[i][0], ay = ring[i][1];
      const bx = ring[i + 1][0], by = ring[i + 1][1];
      const cross = ax * by - bx * ay;
      twiceArea += cross;
      x += (ax + bx) * cross;
      y += (ay + by) * cross;
    }
    if (!twiceArea) return null;
    return [x / (3 * twiceArea), y / (3 * twiceArea)];
  }

  /* Where a country's name goes: as near its centre of area as it can sit
     without crowding a border.

     The pole of inaccessibility is the safest point — the one furthest inside
     — but on a lopsided country it is not the point a reader would call the
     middle. So the label starts at the centre of area and walks back towards
     the pole until it has room around it: at least three fifths of what the
     pole itself has. Round countries barely move; awkward ones end up
     somewhere between the two, and none ends up outside itself. */
  function labelPointFor(ring, pole) {
    if (!pole || !pole.point) return pole;
    const centre = areaCentroid(ring);
    if (!centre) return pole;

    const wanted = pole.distance * 0.6;
    for (let t = 1; t > 0; t -= 0.1) {
      const x = pole.point[0] + (centre[0] - pole.point[0]) * t;
      const y = pole.point[1] + (centre[1] - pole.point[1]) * t;
      if (pointInRing(x, y, ring) && distanceToRing(x, y, ring) >= wanted) {
        return { point: [x, y], distance: pole.distance };
      }
    }
    return pole;
  }

  function poleOfInaccessibility(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ring.forEach(function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });

    function search(fromX, toX, fromY, toY, stepX, stepY, seed, seedDistance) {
      let best = seed;
      let bestDistance = seedDistance;
      for (let x = fromX; x <= toX; x += stepX) {
        for (let y = fromY; y <= toY; y += stepY) {
          if (!pointInRing(x, y, ring)) continue;
          const distance = distanceToRing(x, y, ring);
          if (distance > bestDistance) {
            bestDistance = distance;
            best = [x, y];
          }
        }
      }
      return { point: best, distance: bestDistance };
    }

    // Croatia's horseshoe and the Greek mainland are narrow enough to fall
    // between the lines of a coarse grid, so tighten it until something lands.
    for (let divisions = 24; divisions <= 96; divisions *= 2) {
      const stepX = (maxX - minX) / divisions;
      const stepY = (maxY - minY) / divisions;
      if (!stepX || !stepY) break;

      let found = search(minX, maxX, minY, maxY, stepX, stepY, null, -Infinity);
      if (!found.point) continue;

      // Three refinement passes around the winner: each one looks at a
      // sixteenth of the last one's step, so the label sits on the country's
      // true centre rather than on the nearest coarse grid line.
      let fineX = stepX, fineY = stepY;
      for (let pass = 0; pass < 3; pass++) {
        fineX /= 4;
        fineY /= 4;
        found = search(
          found.point[0] - fineX * 4, found.point[0] + fineX * 4,
          found.point[1] - fineY * 4, found.point[1] + fineY * 4,
          fineX, fineY, found.point, found.distance
        );
      }
      return { point: found.point, radius: found.distance };
    }

    return null;
  }

  /* Projects a FeatureCollection once and returns SVG-ready paths plus the
     viewBox that fits them, so the map never re-projects on redraw. */
  function layout(collection, width, height, padding) {
    const projected = collection.features.map(function (feature) {
      const polygons = feature.geometry.coordinates.map(function (polygon) {
        return polygon[0].map(function (point) { return project(point[0], point[1]); });
      });
      return { feature: feature, polygons: polygons };
    });

    // The frame is fitted to the member states, plus the few neighbours marked
    // to be kept whole — today only Azerbaijan, which sits east of the Union and
    // would otherwise fall outside the picture. Everything else is drawn on the
    // same projection and runs off the edge, where the viewBox crops it: Norway's
    // Arctic islands at the top, Greenland in the corner, as a map crops Russia.
    // Europe keeps the middle of the frame; the far places are anchors, not mass.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    projected.forEach(function (item) {
      const properties = item.feature.properties;
      if (properties.member === false && properties.frame !== true) return;
      item.polygons.forEach(function (ring) {
        ring.forEach(function (p) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        });
      });
    });

    const inner = { w: width - padding * 2, h: height - padding * 2 };
    const scale = Math.min(inner.w / (maxX - minX), inner.h / (maxY - minY));
    const offsetX = padding + (inner.w - (maxX - minX) * scale) / 2;
    const offsetY = padding + (inner.h - (maxY - minY) * scale) / 2;

    const toScreen = function (p) {
      return [(p[0] - minX) * scale + offsetX, (p[1] - minY) * scale + offsetY];
    };

    return {
      width: width,
      height: height,
      shapes: projected.map(function (item) {
        let d = '';
        let cx = 0, cy = 0, count = 0;
        // Starts at nothing, not at -Infinity: |area| > |-Infinity| is never
        // true, which silently disabled every label placement below.
        let largestArea = 0;
        let labelPoint = null;
        let inscribed = 0;

        item.polygons.forEach(function (ring) {
          const screen = ring.map(toScreen);
          d += 'M' + screen.map(function (p) {
            return p[0].toFixed(1) + ' ' + p[1].toFixed(1);
          }).join('L') + 'Z';

          // Label and focus ring go on the biggest landmass, not on an island.
          let area = 0;
          for (let i = 0; i < screen.length - 1; i++) {
            const a = screen[i], b = screen[i + 1];
            area += a[0] * b[1] - b[0] * a[1];
          }
          area = Math.abs(area) / 2;
          if (area > largestArea) {
            largestArea = area;
            if (item.feature.properties.member === false) {
              labelPoint = screen[0];
            } else {
              const pole = poleOfInaccessibility(screen);
              const placed = pole ? labelPointFor(screen, { point: pole.point, distance: pole.radius }) : null;
              labelPoint = placed ? placed.point : screen[0];
              inscribed = pole ? pole.radius : 0;
            }
          }
          screen.forEach(function (p) { cx += p[0]; cy += p[1]; count++; });
        });

        return {
          code: item.feature.properties.code,
          name: item.feature.properties.name,
          member: item.feature.properties.member !== false,
          path: d,
          area: largestArea,
          // How much room the shape actually has for a label: Croatia's arm is
          // three pixels wide however many square pixels the country covers.
          inscribed: inscribed,
          centroid: labelPoint || [cx / count, cy / count]
        };
      })
    };
  }

  global.Projection = { project: project, layout: layout };
})(window);
