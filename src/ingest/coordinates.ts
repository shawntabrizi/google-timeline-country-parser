/** Coordinate parsing for the shapes seen across Timeline export versions. */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export interface LatLng {
  lat: number;
  lng: number;
}

function fromPair(lat: number, lng: number): LatLng | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || !inRange(lat, lng)) {
    return null;
  }
  return { lat, lng };
}

/** Parses "18.45°, -66.07°" style strings (and plain "18.45, -66.07"). */
function fromString(value: string): LatLng | null {
  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) {
    return null;
  }
  return fromPair(Number.parseFloat(matches[0]!), Number.parseFloat(matches[1]!));
}

function fromObject(value: Record<string, unknown>): LatLng | null {
  const v = value as {
    lat?: unknown;
    lng?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    latE7?: unknown;
    lngE7?: unknown;
    latitudeE7?: unknown;
    longitudeE7?: unknown;
  };
  if (isFiniteNumber(v.lat) && isFiniteNumber(v.lng)) {
    return fromPair(v.lat, v.lng);
  }
  if (isFiniteNumber(v.latitude) && isFiniteNumber(v.longitude)) {
    return fromPair(v.latitude, v.longitude);
  }
  if (isFiniteNumber(v.latE7) && isFiniteNumber(v.lngE7)) {
    return fromPair(v.latE7 / 1e7, v.lngE7 / 1e7);
  }
  if (isFiniteNumber(v.latitudeE7) && isFiniteNumber(v.longitudeE7)) {
    return fromPair(v.latitudeE7 / 1e7, v.longitudeE7 / 1e7);
  }
  return null;
}

export function parseCoordinate(value: unknown): LatLng | null {
  if (typeof value === "string") {
    return fromString(value);
  }
  if (value && typeof value === "object") {
    return fromObject(value as Record<string, unknown>);
  }
  return null;
}
