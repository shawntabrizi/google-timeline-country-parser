/**
 * Builds the per-day presence model from observations.
 *
 * Design: a day keeps EVERY region observed that day, not a single winner.
 * Presence tests generally count a day if you were in the region any part of
 * the day, so collapsing a travel day to one location silently miscounts —
 * exactly at the day-boundary margins where these counts matter.
 *
 * Confidence: every day is observed / inferred / unknown. Inference is
 * deliberately conservative and clearly labeled; compliance decisions should
 * rest on observed days.
 */

import {
  addDays,
  dayKeyOfTimestamp,
  dayKeysForYear,
  splitIntoContiguousRuns,
  todayKeyLocal,
} from "../dates.ts";
import type {
  DayHistory,
  DayRecord,
  DayRegionPresence,
  InferenceConfidence,
  Observation,
  RegionResolution,
} from "../types.ts";
import type { Resolver } from "../geo/resolver.ts";

export interface BuildOptions {
  /** Years to include. Defaults to every year with at least one observation. */
  years?: number[];
  /** Fill missing days with bounded inference (default true). */
  fillMissingDays?: boolean;
  /** Max size of one-sided (edge) gaps to fill. Default 7. */
  maxInferGapDays?: number;
  /** Today override for tests. */
  todayKey?: string;
}

export interface BuildStats {
  observationsUsed: number;
  observationsOutOfScope: number;
  daysTotal: number;
  daysObserved: number;
  daysInferred: number;
  daysUnknown: number;
  yearsIncluded: number[];
}

export interface PresenceModel {
  history: DayHistory;
  stats: BuildStats;
}

interface DayAccumulator {
  regions: Map<string, DayRegionPresence>;
  /** Non-airborne observation count per region key. */
  groundCounts: Map<string, number>;
  lastEpoch: number;
  lastCountry: string | null;
  firstEpoch: number;
  firstCountry: string | null;
  firstCodes: string[];
  lastCodes: string[];
}

function regionKey(resolution: RegionResolution): string {
  return resolution.codes.length > 0
    ? resolution.codes[resolution.codes.length - 1]!
    : resolution.country;
}

/**
 * Overflight detection. Two signals mark a fix as airborne:
 *  1. Google's own FLYING activity windows (tagged at ingest, authoritative).
 *  2. A speed heuristic between consecutive fixes — fallback for raw
 *     positions, unlabeled legs, and teleporting stale WiFi fixes.
 * Regions evidenced ONLY by airborne fixes are flight-path artifacts —
 * flying over Cuba is not presence in Cuba — kept in the day record but
 * flagged and never counted.
 *
 * 400 km/h clears every train (~320 max); the 40 km distance floor keeps GPS
 * jitter between rapid nearby fixes from reading as supersonic.
 */
const AIRBORNE_MIN_KMH = 400;
const AIRBORNE_MIN_LEG_KM = 40;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

interface TaggedObservation {
  observation: Observation;
  epoch: number;
  airborne: boolean;
}

function tagAirborne(observations: Observation[]): TaggedObservation[] {
  const tagged: TaggedObservation[] = observations
    .map((observation) => ({
      observation,
      epoch: Date.parse(observation.time),
      airborne: observation.airborne === true,
    }))
    .filter((t) => Number.isFinite(t.epoch))
    .sort((a, b) => a.epoch - b.epoch);

  for (let i = 1; i < tagged.length; i += 1) {
    const prev = tagged[i - 1]!;
    const current = tagged[i]!;
    const hours = (current.epoch - prev.epoch) / 3_600_000;
    if (hours <= 0) {
      continue;
    }
    const km = haversineKm(prev.observation, current.observation);
    if (km >= AIRBORNE_MIN_LEG_KM && km / hours >= AIRBORNE_MIN_KMH) {
      prev.airborne = true;
      current.airborne = true;
    }
  }
  return tagged;
}

function gapConfidence(gapDays: number): InferenceConfidence {
  if (gapDays <= 7) return "high";
  if (gapDays <= 30) return "medium";
  return "low";
}

export function buildPresenceModel(
  observations: Observation[],
  resolve: Resolver,
  options: BuildOptions = {}
): PresenceModel {
  const fillMissingDays = options.fillMissingDays !== false;
  const maxInferGapDays = options.maxInferGapDays ?? 7;
  const today = options.todayKey ?? todayKeyLocal();

  // --- Group observations into days, resolving regions. ---
  const accumulators = new Map<string, DayAccumulator>();
  let outOfScope = 0;

  const yearFilter = options.years ? new Set(options.years.map(String)) : null;

  for (const { observation, epoch, airborne } of tagAirborne(observations)) {
    const day = dayKeyOfTimestamp(observation.time);
    if (!day || day > today) {
      outOfScope += 1;
      continue;
    }
    if (yearFilter && !yearFilter.has(day.slice(0, 4))) {
      outOfScope += 1;
      continue;
    }

    const resolution = resolve(observation.lat, observation.lng);
    const key = regionKey(resolution);

    let accumulator = accumulators.get(day);
    if (!accumulator) {
      accumulator = {
        regions: new Map(),
        groundCounts: new Map(),
        lastEpoch: -Infinity,
        lastCountry: null,
        lastCodes: [],
        firstEpoch: Infinity,
        firstCountry: null,
        firstCodes: [],
      };
      accumulators.set(day, accumulator);
    }

    const existing = accumulator.regions.get(key);
    if (!existing) {
      accumulator.regions.set(key, {
        country: resolution.country,
        codes: resolution.codes,
        firstSeen: observation.time,
        lastSeen: observation.time,
        observationCount: 1,
        sources: [observation.source],
      });
    } else {
      existing.observationCount += 1;
      if (epoch < Date.parse(existing.firstSeen!)) {
        existing.firstSeen = observation.time;
      }
      if (epoch >= Date.parse(existing.lastSeen!)) {
        existing.lastSeen = observation.time;
      }
      if (!existing.sources.includes(observation.source)) {
        existing.sources.push(observation.source);
      }
    }

    if (airborne) {
      continue; // airborne fixes never anchor day boundaries or ground counts
    }
    accumulator.groundCounts.set(key, (accumulator.groundCounts.get(key) ?? 0) + 1);
    if (epoch >= accumulator.lastEpoch) {
      accumulator.lastEpoch = epoch;
      accumulator.lastCountry = resolution.country;
      accumulator.lastCodes = resolution.codes;
    }
    if (epoch < accumulator.firstEpoch) {
      accumulator.firstEpoch = epoch;
      accumulator.firstCountry = resolution.country;
      accumulator.firstCodes = resolution.codes;
    }
  }

  // --- Determine the day span. ---
  const observedYears = new Set<number>();
  for (const day of accumulators.keys()) {
    observedYears.add(Number.parseInt(day.slice(0, 4), 10));
  }
  const years = options.years ?? Array.from(observedYears).sort((a, b) => a - b);

  const history: DayHistory = {};
  for (const year of years) {
    for (const day of dayKeysForYear(year)) {
      if (day > today) {
        continue;
      }
      const accumulator = accumulators.get(day);
      if (!accumulator) {
        history[day] = {
          date: day,
          status: "unknown",
          regions: [],
          endOfDayCountry: null,
        };
        continue;
      }
      // Regions whose only evidence is airborne fixes are overflight
      // artifacts (countries flown over, teleporting stale fixes). They are
      // not presence and are dropped from the output entirely.
      const regions: DayRegionPresence[] = [];
      for (const [key, presence] of accumulator.regions) {
        if ((accumulator.groundCounts.get(key) ?? 0) > 0) {
          regions.push(presence);
        }
      }
      if (regions.length === 0) {
        // Every fix that day was airborne: no presence anywhere.
        history[day] = {
          date: day,
          status: "unknown",
          regions: [],
          endOfDayCountry: null,
        };
        continue;
      }
      regions.sort((a, b) => b.observationCount - a.observationCount);
      history[day] = {
        date: day,
        status: "observed",
        regions,
        endOfDayCountry: accumulator.lastCountry,
      };
    }
  }

  // --- Bounded inference over contiguous runs only. ---
  if (fillMissingDays) {
    const dayKeys = Object.keys(history);
    for (const run of splitIntoContiguousRuns(dayKeys)) {
      fillGaps(history, run, maxInferGapDays);
    }
  }

  // --- Stats. ---
  const stats: BuildStats = {
    observationsUsed: observations.length - outOfScope,
    observationsOutOfScope: outOfScope,
    daysTotal: 0,
    daysObserved: 0,
    daysInferred: 0,
    daysUnknown: 0,
    yearsIncluded: years,
  };
  for (const record of Object.values(history)) {
    stats.daysTotal += 1;
    if (record.status === "observed") stats.daysObserved += 1;
    else if (record.status === "inferred") stats.daysInferred += 1;
    else stats.daysUnknown += 1;
  }

  return { history, stats };
}

function syntheticPresence(country: string, codes: string[]): DayRegionPresence {
  return {
    country,
    codes,
    firstSeen: null,
    lastSeen: null,
    observationCount: 0,
    sources: [],
  };
}

/**
 * Where you ended the previous known day / started the next known day are the
 * anchors for filling a gap: they approximate where you slept.
 */
function fillGaps(history: DayHistory, run: string[], maxInferGapDays: number): void {
  for (let index = 0; index < run.length; index += 1) {
    if (history[run[index]!]!.status !== "unknown") {
      continue;
    }

    const start = index;
    while (index < run.length && history[run[index]!]!.status === "unknown") {
      index += 1;
    }
    const end = index - 1;
    const gapDays = end - start + 1;

    const prevRecord = start > 0 ? history[run[start - 1]!]! : null;
    const nextRecord = index < run.length ? history[run[index]!]! : null;

    const prevCountry = prevRecord?.endOfDayCountry ?? null;
    const prevCodes =
      prevRecord?.regions.find((r) => r.country === prevCountry)?.codes ?? [];
    const nextFirst = nextRecord?.regions
      .filter((r) => r.firstSeen !== null)
      .sort((a, b) => Date.parse(a.firstSeen!) - Date.parse(b.firstSeen!))[0];
    const nextCountry = nextFirst?.country ?? null;
    const nextCodes = nextFirst?.codes ?? [];

    if (prevCountry && prevCountry !== "Unknown" && prevCountry === nextCountry) {
      // Anchored on both sides by the same country: fill regardless of size,
      // with confidence graded by gap length.
      const confidence = gapConfidence(gapDays);
      for (let cursor = start; cursor <= end; cursor += 1) {
        const day = run[cursor]!;
        history[day] = {
          date: day,
          status: "inferred",
          regions: [syntheticPresence(prevCountry, prevCodes)],
          endOfDayCountry: prevCountry,
          inference: {
            kind: "interpolate_between",
            confidence,
            country: prevCountry,
            gapDays,
          },
        };
      }
      continue;
    }

    // One-sided gaps (run edges, or mismatched anchors) are riskier: bounded.
    if (gapDays > maxInferGapDays) {
      continue;
    }

    if (prevCountry && prevCountry !== "Unknown" && !nextRecord) {
      for (let cursor = start; cursor <= end; cursor += 1) {
        const day = run[cursor]!;
        history[day] = {
          date: day,
          status: "inferred",
          regions: [syntheticPresence(prevCountry, prevCodes)],
          endOfDayCountry: prevCountry,
          inference: {
            kind: "carry_forward",
            confidence: "medium",
            country: prevCountry,
            gapDays,
          },
        };
      }
      continue;
    }

    if (!prevRecord && nextCountry && nextCountry !== "Unknown") {
      for (let cursor = start; cursor <= end; cursor += 1) {
        const day = run[cursor]!;
        history[day] = {
          date: day,
          status: "inferred",
          regions: [syntheticPresence(nextCountry, nextCodes)],
          endOfDayCountry: nextCountry,
          inference: {
            kind: "carry_backward",
            confidence: "medium",
            country: nextCountry,
            gapDays,
          },
        };
      }
    }
  }
}
