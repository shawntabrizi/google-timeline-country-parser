/** Synthetic fixtures. Coordinates are public landmarks, never personal data. */

import type {
  DayHistory,
  DayRecord,
  DayRegionPresence,
  Observation,
  ObservationSource,
} from "../src/types.ts";

export const LANDMARKS = {
  sanJuanPR: { lat: 18.4655, lng: -66.1057 }, // Puerto Rico
  nycUS: { lat: 40.7128, lng: -74.006 }, // US mainland
  londonUK: { lat: 51.5074, lng: -0.1278 },
  parisFR: { lat: 48.8566, lng: 2.3522 },
  berlinDE: { lat: 52.52, lng: 13.405 },
  hongKong: { lat: 22.3193, lng: 114.1694 },
  pointNemo: { lat: -48.87, lng: -123.39 }, // remotest ocean, no EEZ
};

export function obs(
  time: string,
  where: { lat: number; lng: number },
  source: ObservationSource = "visit_end"
): Observation {
  return { time, lat: where.lat, lng: where.lng, source };
}

export function presence(
  country: string,
  codes: string[],
  firstSeen: string | null = null,
  lastSeen: string | null = null
): DayRegionPresence {
  return {
    country,
    codes,
    firstSeen,
    lastSeen,
    observationCount: firstSeen ? 1 : 0,
    sources: firstSeen ? ["visit_end"] : [],
  };
}

export const PR = (): DayRegionPresence => presence("Puerto Rico", ["USA", "PRI"]);
export const US = (): DayRegionPresence => presence("United States of America", ["USA"]);
export const UK = (): DayRegionPresence => presence("United Kingdom", ["GBR"]);
export const FR = (): DayRegionPresence => presence("France", ["FRA"]);

/** Observed day; endOfDay defaults to the last listed region. */
export function observedDay(
  date: string,
  regions: DayRegionPresence[],
  endOfDayCountry?: string
): DayRecord {
  return {
    date,
    status: "observed",
    regions: regions.map((r) => ({
      ...r,
      firstSeen: r.firstSeen ?? `${date}T08:00:00.000+00:00`,
      lastSeen: r.lastSeen ?? `${date}T20:00:00.000+00:00`,
      observationCount: Math.max(1, r.observationCount),
    })),
    endOfDayCountry: endOfDayCountry ?? regions[regions.length - 1]?.country ?? null,
  };
}

export function inferredDay(date: string, basis: DayRegionPresence): DayRecord {
  return {
    date,
    status: "inferred",
    regions: [{ ...basis, firstSeen: null, lastSeen: null, observationCount: 0, sources: [] }],
    endOfDayCountry: basis.country,
    inference: {
      kind: "interpolate_between",
      confidence: "high",
      country: basis.country,
      gapDays: 1,
    },
  };
}

export function unknownDay(date: string): DayRecord {
  return { date, status: "unknown", regions: [], endOfDayCountry: null };
}

export function historyOf(records: DayRecord[]): DayHistory {
  return Object.fromEntries(records.map((r) => [r.date, r]));
}

/** Every day of a year as observed single-region days (helper for vectors). */
export function fillYear(
  year: number,
  region: () => DayRegionPresence,
  fromDay = 1,
  toDayCount = 366
): DayRecord[] {
  const records: DayRecord[] = [];
  const start = Date.UTC(year, 0, fromDay);
  for (let i = 0; i < toDayCount; i += 1) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    if (!date.startsWith(String(year))) {
      break;
    }
    records.push(observedDay(date, [region()]));
  }
  return records;
}
