/**
 * Minimal, dependency-free point-in-polygon lookup over a GeoJSON
 * FeatureCollection, with a per-feature bounding-box prefilter.
 *
 * Supply-chain note: this replaces a tree of geo packages on purpose. The
 * logic below is small enough to audit by eye; the boundary *data* is vendored
 * and pinned (see src/geo/data/).
 */

type Position = [number, number]; // [lng, lat]
type Ring = Position[];

export interface GeoFeature {
  properties: Record<string, unknown>;
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: unknown;
  } | null;
}

interface IndexedPolygon {
  feature: GeoFeature;
  /** Outer ring first, holes after — even-odd rule handles both uniformly. */
  rings: Ring[];
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

function ringsOfPolygon(coordinates: Ring[]): Ring[] {
  return coordinates;
}

function computeBbox(rings: Ring[]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Even-odd ray casting across all rings (outer + holes). */
function pointInRings(lng: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      const intersects =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export class RegionIndex {
  private polygons: IndexedPolygon[] = [];

  constructor(features: GeoFeature[]) {
    for (const feature of features) {
      const geometry = feature.geometry;
      if (!geometry) {
        continue;
      }
      if (geometry.type === "Polygon") {
        const rings = ringsOfPolygon(geometry.coordinates as Ring[]);
        this.polygons.push({ feature, rings, bbox: computeBbox(rings) });
      } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates as Ring[][]) {
          const rings = ringsOfPolygon(polygon);
          this.polygons.push({ feature, rings, bbox: computeBbox(rings) });
        }
      }
    }
  }

  /** All features containing the point (a point can match nested regions). */
  query(lat: number, lng: number): GeoFeature[] {
    const matches: GeoFeature[] = [];
    for (const { feature, rings, bbox } of this.polygons) {
      if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) {
        continue;
      }
      if (pointInRings(lng, lat, rings) && !matches.includes(feature)) {
        matches.push(feature);
      }
    }
    return matches;
  }
}
