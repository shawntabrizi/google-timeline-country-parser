/**
 * Local calendar day of an observation, in the time zone of the PLACE.
 *
 * Why not the timestamp's own offset: Google renders every timestamp of an
 * export in the phone's time zone at export time, not the zone where the
 * record was made. A San Juan evening reads as the next day in an export
 * made from a +07:00 zone. Day keys built from that text depend on where you
 * happened to export, and mixed exports disagree with each other.
 *
 * Why not UTC: presence tests count calendar days ("present at any time
 * during the day"), and evidence (stamps, boarding passes, receipts) is dated
 * in local time. UTC midnight is 20:00 in Puerto Rico, so an evening arrival
 * would land on the wrong day.
 *
 * So: instants are the only stored truth; a day key is derived at the end as
 * the calendar date of that instant in the zone of the observed location.
 *
 * Zone choice: the IANA zone.tab (vendored, public domain) lists every zone
 * with its country and a reference city. A point takes the zone of the
 * nearest reference city in its own country (falling back up the ownership
 * chain). Single-zone countries and territories (Puerto Rico, most of
 * Europe, ...) are exact. In multi-zone countries (US, Canada, Mexico,
 * Brazil, Russia, Australia, ...) the nearest reference city only
 * approximates the zone polygons and can be wrong far from any border: in
 * the US, Pensacola (Central) maps to an Eastern zone, Amarillo (Central) to
 * Mountain, and Rapid City (Mountain) to Central. A wrong zone moves a fix
 * across midnight only when it is within an hour of local midnight, and only
 * day counts for those countries can change. Exact results need tz boundary
 * polygons (not vendored, for size). Points outside every country (open
 * ocean) use nautical time from longitude.
 */

import { readFileSync } from "node:fs";

interface ZoneEntry {
  zone: string;
  lat: number;
  lng: number;
}

/** "+182806" / "-0660622" (±DDMM[SS] / ±DDDMM[SS]) -> decimal degrees. */
function parseIsoCoordinatePart(part: string, degreeDigits: number): number {
  const sign = part[0] === "-" ? -1 : 1;
  const digits = part.slice(1);
  const degrees = Number(digits.slice(0, degreeDigits));
  const minutes = Number(digits.slice(degreeDigits, degreeDigits + 2));
  const seconds = digits.length > degreeDigits + 2 ? Number(digits.slice(degreeDigits + 2)) : 0;
  return sign * (degrees + minutes / 60 + seconds / 3600);
}

export function parseZoneTab(content: string): Map<string, ZoneEntry[]> {
  const byCountry = new Map<string, ZoneEntry[]>();
  for (const line of content.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const [country, coordinates, zone] = line.split("\t");
    const match = coordinates?.match(/^([+-]\d+)([+-]\d+)$/);
    if (!country || !zone || !match) {
      continue;
    }
    const entries = byCountry.get(country) ?? [];
    entries.push({
      zone,
      lat: parseIsoCoordinatePart(match[1]!, 2),
      lng: parseIsoCoordinatePart(match[2]!, 3),
    });
    byCountry.set(country, entries);
  }
  return byCountry;
}

/**
 * Regions with no zone.tab entry and no owner chain to fall back on. Kosovo
 * (XK) is not an ISO 3166 assignment, so tzdata omits it; it keeps Serbia's
 * zone rules (CET with DST).
 */
const ZONE_ALIASES: Record<string, string> = { XK: "RS" };

let zonesByCountry: Map<string, ZoneEntry[]> | null = null;

function zones(): Map<string, ZoneEntry[]> {
  if (!zonesByCountry) {
    const path = new URL("./data/zone.tab", import.meta.url).pathname;
    zonesByCountry = parseZoneTab(readFileSync(path, "utf8"));
  }
  return zonesByCountry;
}

/** Fixed-offset nautical zone from longitude. Note Etc/GMT signs are inverted. */
export function longitudeZone(lng: number): string {
  const hours = Math.max(-12, Math.min(12, Math.round(lng / 15)));
  if (hours === 0) {
    return "Etc/GMT";
  }
  return `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
}

/**
 * Zone for a point, given the ISO alpha-2 codes of its region from most to
 * least specific (e.g. ["PR", "US"]). Empty list = outside every country.
 */
export function zoneForPoint(iso2Chain: string[], lat: number, lng: number): string {
  for (const code of iso2Chain) {
    const iso2 = ZONE_ALIASES[code] ?? code;
    const candidates = zones().get(iso2);
    if (!candidates || candidates.length === 0) {
      continue;
    }
    if (candidates.length === 1) {
      return candidates[0]!.zone;
    }
    let best = candidates[0]!;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = squaredDegreeDistance(lat, lng, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best.zone;
  }
  return longitudeZone(lng);
}

/** Equirectangular distance; ample for picking the nearest reference city. */
function squaredDegreeDistance(lat: number, lng: number, entry: ZoneEntry): number {
  const dLat = lat - entry.lat;
  let dLng = Math.abs(lng - entry.lng);
  if (dLng > 180) {
    dLng = 360 - dLng;
  }
  dLng *= Math.cos(((lat + entry.lat) / 2) * (Math.PI / 180));
  return dLat * dLat + dLng * dLng;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar day (YYYY-MM-DD) of an instant in an IANA zone. */
export function localDayKey(epochMs: number, zone: string): string {
  let formatter = formatters.get(zone);
  if (!formatter) {
    // en-CA formats dates as YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter.format(epochMs);
}

/** Calendar day of an instant in UTC (used only for boundary-sensitivity checks). */
export function utcDayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
