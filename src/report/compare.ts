/**
 * Regression harness: day-by-day comparison of two run outputs.
 *
 * Accepts both formats:
 *  - v1 (legacy engine): history[date] = { country, guess, codes?, ... } | null
 *  - v2 (this engine):   history[date] = DayRecord
 *
 * Comparison is by ISO code when available (names differ between datasets:
 * "United States" vs "United States of America"), falling back to normalized
 * names. Every changed day lands in a category so a migration diff can be
 * reviewed and explained instead of silently absorbed.
 */

import type { DayHistory, DayRecord } from "../types.ts";

interface V1Record {
  country?: string;
  guess?: boolean;
  codes?: string[];
  source?: string;
}

interface DaySide {
  /** Most-specific code, or null when side has no data. */
  code: string | null;
  /** All matching codes/names for set comparison. */
  keys: Set<string>;
  countries: string[];
  guessed: boolean;
}

export type CompareCategory =
  | "same"
  | "same_plus_travel"
  | "changed"
  | "newly_attributed"
  | "newly_missing_was_observed"
  | "newly_missing_was_guessed"
  | "both_empty";

export interface DayDiff {
  date: string;
  category: CompareCategory;
  left: string;
  right: string;
}

export interface CompareResult {
  counts: Record<CompareCategory, number>;
  diffs: DayDiff[]; // everything not "same"/"both_empty"
  daysCompared: number;
}

const NAME_ALIASES: Record<string, string> = {
  "united states of america": "united states",
  "russian federation": "russia",
};

function normalizeName(name: string): string {
  const lower = name.trim().toLowerCase();
  return NAME_ALIASES[lower] ?? lower;
}

function sideOfV1(record: V1Record | null): DaySide {
  if (!record || !record.country || record.country === "Unknown") {
    return { code: null, keys: new Set(), countries: [], guessed: false };
  }
  const keys = new Set<string>();
  keys.add(normalizeName(record.country));
  const codes = record.codes ?? [];
  for (const code of codes) {
    keys.add(code.toUpperCase());
  }
  return {
    code: codes.length > 0 ? codes[codes.length - 1]!.toUpperCase() : null,
    keys,
    countries: [record.country],
    guessed: record.guess === true,
  };
}

function sideOfV2(record: DayRecord | null): DaySide {
  if (!record || record.status === "unknown") {
    return { code: null, keys: new Set(), countries: [], guessed: false };
  }
  const keys = new Set<string>();
  const countries: string[] = [];
  let code: string | null = null;
  for (const presence of record.regions) {
    if (presence.country === "Unknown") {
      continue;
    }
    countries.push(presence.country);
    keys.add(normalizeName(presence.country));
    for (const c of presence.codes) {
      keys.add(c.toUpperCase());
    }
    const specific = presence.codes[presence.codes.length - 1];
    if (specific && !code) {
      code = specific.toUpperCase();
    }
  }
  return { code, keys, countries, guessed: record.status === "inferred" };
}

function isV2Record(value: unknown): value is DayRecord {
  return Boolean(value && typeof value === "object" && "status" in (value as object));
}

function sideOf(value: unknown): DaySide {
  if (value === null || value === undefined) {
    return { code: null, keys: new Set(), countries: [], guessed: false };
  }
  return isV2Record(value) ? sideOfV2(value) : sideOfV1(value as V1Record);
}

function describe(side: DaySide): string {
  if (side.countries.length === 0) {
    return "(none)";
  }
  return side.countries.join("+") + (side.guessed ? " (guess)" : "");
}

export function compareHistories(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): CompareResult {
  const counts: Record<CompareCategory, number> = {
    same: 0,
    same_plus_travel: 0,
    changed: 0,
    newly_attributed: 0,
    newly_missing_was_observed: 0,
    newly_missing_was_guessed: 0,
    both_empty: 0,
  };
  const diffs: DayDiff[] = [];
  const dates = Array.from(
    new Set([...Object.keys(left), ...Object.keys(right)])
  ).sort();

  for (const date of dates) {
    const l = sideOf(left[date]);
    const r = sideOf(right[date]);

    let category: CompareCategory;
    if (l.countries.length === 0 && r.countries.length === 0) {
      category = "both_empty";
    } else if (l.countries.length === 0) {
      category = "newly_attributed";
    } else if (r.countries.length === 0) {
      category = l.guessed ? "newly_missing_was_guessed" : "newly_missing_was_observed";
    } else {
      const leftMatchesRight =
        (l.code !== null && r.keys.has(l.code)) ||
        [...l.keys].some((key) => r.keys.has(key));
      if (leftMatchesRight) {
        category = r.countries.length > 1 ? "same_plus_travel" : "same";
      } else {
        category = "changed";
      }
    }

    counts[category] += 1;
    if (category !== "same" && category !== "both_empty") {
      diffs.push({ date, category, left: describe(l), right: describe(r) });
    }
  }

  return { counts, diffs, daysCompared: dates.length };
}

/** Pull the date->record map out of either output file shape. */
export function historyOf(output: unknown): Record<string, unknown> {
  const root = output as { history?: Record<string, unknown> };
  if (root && typeof root === "object" && root.history) {
    return root.history;
  }
  return root as Record<string, unknown>;
}

export type { DayHistory };
