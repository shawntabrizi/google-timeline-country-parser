/**
 * Shared domain types.
 *
 * Domain note: this tool answers "where was I each day, and how sure am I?"
 * Day counts can carry legal weight (residency presence tests), so the model
 * preserves *all* observations per day and an explicit confidence status per
 * day, rather than collapsing to a single winner.
 */

/** A single location observation extracted from an export. */
export interface Observation {
  /** ISO-8601 timestamp as recorded, including its original UTC offset. */
  time: string;
  lat: number;
  lng: number;
  /** Which export structure this came from. */
  source: ObservationSource;
}

export type ObservationSource =
  | "visit_start"
  | "visit_end"
  | "activity_start"
  | "activity_end"
  | "timeline_path"
  | "raw_position";

/** Result of resolving a coordinate to political regions. */
export interface RegionResolution {
  /**
   * Primary region name, most specific first (e.g. "Puerto Rico", not
   * "United States", for a PR coordinate).
   */
  country: string;
  /** ISO 3166-1 alpha-3 codes for all matching regions, least specific first. */
  codes: string[];
}

/** Presence of one region within one day. */
export interface DayRegionPresence {
  country: string;
  codes: string[];
  /** ISO timestamps (with original offsets) of first/last observation. Null for inferred presence. */
  firstSeen: string | null;
  lastSeen: string | null;
  observationCount: number;
  sources: ObservationSource[];
}

export type DayStatus = "observed" | "inferred" | "unknown";

export type InferenceKind = "interpolate_between" | "carry_forward" | "carry_backward";
export type InferenceConfidence = "high" | "medium" | "low";

export interface DayRecord {
  date: string; // YYYY-MM-DD (local day where the observations were recorded)
  status: DayStatus;
  /** All regions touched this day. Empty when status is "unknown". */
  regions: DayRegionPresence[];
  /** Country of the last observation of the day (midnight approximation). */
  endOfDayCountry: string | null;
  inference?: {
    kind: InferenceKind;
    confidence: InferenceConfidence;
    /** Country the inference was based on. */
    country: string;
    gapDays: number;
  };
}

/** date -> record. Every calendar day in scope is present. */
export type DayHistory = Record<string, DayRecord>;

// --- Rules ---

export interface RegionMatcher {
  /** Match by name, case-insensitive (e.g. "Puerto Rico"). */
  country?: string;
  /** Match by ISO 3166-1 alpha-3 code (e.g. "PRI"). Preferred: unambiguous. */
  code?: string;
  /** Match any of these ISO alpha-3 codes (e.g. the Schengen area list). */
  codes?: string[];
  /**
   * When true, only the *most specific* code of a presence is compared.
   * Example: a Puerto Rico day carries codes ["USA","PRI"]. A matcher for
   * "USA" normally matches it; with exact=true it does not — which is what
   * tests like the US Substantial Presence Test (territories excluded) need.
   */
  exact?: boolean;
}

export type CountingSemantics = "any-presence" | "midnights";

export type PeriodConfig =
  | { type: "calendar-year" }
  | { type: "offset-year"; start: string /* MM-DD */ }
  | { type: "rolling-window"; windowDays: number }
  | {
      type: "multi-year-weighted";
      /** Weight per year, current year first (e.g. [1, 1/3, 1/6]). */
      weights: number[];
      /** Minimum raw days in the current year for the test to apply. */
      minCurrentYearDays?: number;
    };

export interface RuleConfig {
  id: string;
  title: string;
  region: RegionMatcher;
  counting: CountingSemantics;
  period: PeriodConfig;
  threshold: number;
  /** "at-least": residency-style tests. "at-most": stay-limit tests. */
  comparison: "at-least" | "at-most";
  references?: string[];
  /** What this rule does NOT model. Always displayed. */
  notes?: string;
}

export interface PeriodResult {
  /** Human label, e.g. "2024", "2024/25 (from 04-06)", "window ending 2024-06-01". */
  period: string;
  observedDays: number;
  inferredDays: number;
  /** observed + inferred */
  totalDays: number;
  threshold: number;
  comparison: "at-least" | "at-most";
  /** Verdict using observed days only (the defensible number). */
  satisfiedObserved: boolean;
  /** Verdict including inferred days. */
  satisfiedWithInferred: boolean;
  /** Days in the period with no data at all (coverage gap warning). */
  unknownDays: number;
  /**
   * Set when the period's formula reaches outside the loaded data (e.g. a
   * 3-year test evaluated with prior years excluded by --years, or a rolling
   * window extending before the first loaded day) AND the verdict could flip
   * if that data were present. An incomplete verdict must never be displayed
   * as a plain PASS/FAIL.
   */
  incomplete?: boolean;
  /** Years the formula referenced but that are absent from the loaded data. */
  missingYears?: string[];
  detail?: string;
}

export interface RuleResult {
  rule: RuleConfig;
  periods: PeriodResult[];
  disclaimer: string;
}
