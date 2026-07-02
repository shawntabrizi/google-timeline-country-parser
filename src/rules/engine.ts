/**
 * Generic presence-test engine. A rule is data (see RuleConfig): a region
 * matcher, counting semantics, a period shape, and a threshold. The engine
 * always reports observed-only and with-inferred counts separately — the
 * observed number is the defensible one.
 */

import { addDays, dayKeyToEpochUtc, ONE_DAY_MS } from "../dates.ts";
import type {
  DayHistory,
  DayRecord,
  DayRegionPresence,
  PeriodResult,
  RegionMatcher,
  RuleConfig,
  RuleResult,
} from "../types.ts";

export const DISCLAIMER =
  "Not tax or legal advice. Presence tests are modeled in simplified form (see the rule's notes); verify important results with a professional.";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function presenceMatches(matcher: RegionMatcher, presence: DayRegionPresence): boolean {
  const wantedCodes = matcher.code ? [matcher.code] : (matcher.codes ?? []);
  if (wantedCodes.length > 0) {
    if (presence.codes.length === 0) {
      return false;
    }
    const candidateCodes = matcher.exact
      ? [presence.codes[presence.codes.length - 1]!]
      : presence.codes;
    return candidateCodes.some((code) => wantedCodes.includes(code));
  }
  if (matcher.country) {
    return normalize(presence.country) === normalize(matcher.country);
  }
  return false;
}

/** Does this day count for the rule? Unknown days never count. */
export function dayCounts(record: DayRecord, rule: RuleConfig): boolean {
  if (record.status === "unknown") {
    return false;
  }
  if (rule.counting === "midnights") {
    if (!record.endOfDayCountry) {
      return false;
    }
    const endPresence = record.regions.find(
      (presence) => presence.country === record.endOfDayCountry
    );
    return endPresence ? presenceMatches(rule.region, endPresence) : false;
  }
  // any-presence (overflight regions are already excluded at build time)
  return record.regions.some((presence) => presenceMatches(rule.region, presence));
}

interface DayFlags {
  date: string;
  observed: boolean; // counts, from an observed day
  inferred: boolean; // counts, from an inferred day
  unknown: boolean; // day exists but has no data
}

function flagDays(history: DayHistory, rule: RuleConfig): DayFlags[] {
  return Object.values(history)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((record) => {
      const counts = dayCounts(record, rule);
      return {
        date: record.date,
        observed: counts && record.status === "observed",
        inferred: counts && record.status === "inferred",
        unknown: record.status === "unknown",
      };
    });
}

function verdict(
  count: number,
  threshold: number,
  comparison: "at-least" | "at-most"
): boolean {
  return comparison === "at-least" ? count >= threshold : count <= threshold;
}

function buildPeriodResult(
  label: string,
  days: DayFlags[],
  rule: RuleConfig,
  detail?: string
): PeriodResult {
  const observedDays = days.filter((d) => d.observed).length;
  const inferredDays = days.filter((d) => d.inferred).length;
  const unknownDays = days.filter((d) => d.unknown).length;
  const result: PeriodResult = {
    period: label,
    observedDays,
    inferredDays,
    totalDays: observedDays + inferredDays,
    threshold: rule.threshold,
    comparison: rule.comparison,
    satisfiedObserved: verdict(observedDays, rule.threshold, rule.comparison),
    satisfiedWithInferred: verdict(
      observedDays + inferredDays,
      rule.threshold,
      rule.comparison
    ),
    unknownDays,
  };
  if (detail !== undefined) {
    result.detail = detail;
  }
  return result;
}

function groupBy(days: DayFlags[], keyOf: (date: string) => string): Map<string, DayFlags[]> {
  const groups = new Map<string, DayFlags[]>();
  for (const day of days) {
    const key = keyOf(day.date);
    const group = groups.get(key) ?? [];
    group.push(day);
    groups.set(key, group);
  }
  return groups;
}

function offsetYearLabel(date: string, startMonthDay: string): string {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const boundary = `${year}-${startMonthDay}`;
  const startYear = date >= boundary ? year : year - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function evaluateRollingWindow(
  days: DayFlags[],
  rule: RuleConfig,
  windowDays: number
): PeriodResult[] {
  if (days.length === 0) {
    return [];
  }
  // Sliding count over calendar days; days outside `history` contribute 0.
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;

  let peak: { end: string; window: DayFlags[] } | null = null;
  let peakTotal = -1;

  for (
    let epoch = dayKeyToEpochUtc(first);
    epoch <= dayKeyToEpochUtc(last);
    epoch += ONE_DAY_MS
  ) {
    const end = new Date(epoch).toISOString().slice(0, 10);
    const start = addDays(end, -(windowDays - 1));
    const window: DayFlags[] = [];
    for (let e = dayKeyToEpochUtc(start); e <= epoch; e += ONE_DAY_MS) {
      const day = byDate.get(new Date(e).toISOString().slice(0, 10));
      if (day) {
        window.push(day);
      }
    }
    const total = window.filter((d) => d.observed || d.inferred).length;
    if (total > peakTotal) {
      peakTotal = total;
      peak = { end, window };
    }
  }

  const results: PeriodResult[] = [];
  // A window reaching before the first loaded day is computed from partial
  // data; a verdict that could flip with the missing days must not be
  // presented as trustworthy.
  const markIfTruncated = (result: PeriodResult, windowStart: string): PeriodResult => {
    if (windowStart < first) {
      result.detail =
        (result.detail ?? "") +
        ` Window starts ${windowStart}, before the first loaded day (${first}) — partial data.`;
      const couldFlip =
        rule.comparison === "at-least" ? !result.satisfiedObserved : result.satisfiedObserved;
      if (couldFlip) {
        result.incomplete = true;
      }
    }
    return result;
  };

  if (peak) {
    results.push(
      markIfTruncated(
        buildPeriodResult(
          `peak ${windowDays}-day window ending ${peak.end}`,
          peak.window,
          rule,
          `Highest count of matching days in any ${windowDays}-day window.`
        ),
        addDays(peak.end, -(windowDays - 1))
      )
    );
  }
  const latestStart = addDays(last, -(windowDays - 1));
  const latestWindow = days.filter((d) => d.date >= latestStart && d.date <= last);
  results.push(
    markIfTruncated(
      buildPeriodResult(
        `latest ${windowDays}-day window ending ${last}`,
        latestWindow,
        rule,
        `Current standing as of the last day with data.`
      ),
      latestStart
    )
  );
  return results;
}

function evaluateMultiYearWeighted(
  days: DayFlags[],
  rule: RuleConfig,
  weights: number[],
  minCurrentYearDays: number | undefined
): PeriodResult[] {
  const byYear = groupBy(days, (date) => date.slice(0, 4));
  const years = Array.from(byYear.keys()).sort();
  const results: PeriodResult[] = [];

  const loadedYears = new Set(years);

  for (const year of years) {
    const yearNumber = Number.parseInt(year, 10);
    let weightedObserved = 0;
    let weightedTotal = 0;
    const parts: string[] = [];
    const missingYears: string[] = [];
    for (let i = 0; i < weights.length; i += 1) {
      const referenced = String(yearNumber - i);
      if (!loadedYears.has(referenced)) {
        // Counting an unloaded year as 0 would silently corrupt the verdict.
        missingYears.push(referenced);
        parts.push(`${referenced}: not loaded`);
        continue;
      }
      const contributing = byYear.get(referenced) ?? [];
      const observed = contributing.filter((d) => d.observed).length;
      const total = contributing.filter((d) => d.observed || d.inferred).length;
      weightedObserved += observed * weights[i]!;
      weightedTotal += total * weights[i]!;
      parts.push(`${referenced}: ${total} x ${weights[i]}`);
    }

    const currentYearDays = byYear.get(year) ?? [];
    const currentObserved = currentYearDays.filter((d) => d.observed).length;
    const currentTotal = currentYearDays.filter((d) => d.observed || d.inferred).length;
    const meetsMinimumObserved =
      minCurrentYearDays === undefined || currentObserved >= minCurrentYearDays;
    const meetsMinimumTotal =
      minCurrentYearDays === undefined || currentTotal >= minCurrentYearDays;

    const observedRounded = Math.round(weightedObserved * 100) / 100;
    const totalRounded = Math.round(weightedTotal * 100) / 100;

    const result: PeriodResult = {
      period: year,
      observedDays: observedRounded,
      inferredDays: Math.round((weightedTotal - weightedObserved) * 100) / 100,
      totalDays: totalRounded,
      threshold: rule.threshold,
      comparison: rule.comparison,
      satisfiedObserved:
        verdict(observedRounded, rule.threshold, rule.comparison) && meetsMinimumObserved,
      satisfiedWithInferred:
        verdict(totalRounded, rule.threshold, rule.comparison) && meetsMinimumTotal,
      unknownDays: currentYearDays.filter((d) => d.unknown).length,
      detail:
        `Weighted days = ${parts.join(" + ")}` +
        (missingYears.length > 0
          ? `; ${missingYears.join(", ")} not loaded (year filter?) — the verdict cannot be trusted until the full window is loaded`
          : "") +
        (minCurrentYearDays !== undefined
          ? `; requires >= ${minCurrentYearDays} days in ${year} itself`
          : ""),
    };
    if (missingYears.length > 0) {
      result.missingYears = missingYears;
      // Only untrustworthy verdicts are marked incomplete: for an at-least
      // test, missing data can only ADD days, so a PASS stands but a FAIL
      // could flip (and vice versa for at-most).
      const couldFlip =
        rule.comparison === "at-least" ? !result.satisfiedObserved : result.satisfiedObserved;
      if (couldFlip) {
        result.incomplete = true;
      }
    }
    results.push(result);
  }
  return results;
}

export function evaluateRule(history: DayHistory, rule: RuleConfig): RuleResult {
  const days = flagDays(history, rule);
  let periods: PeriodResult[];

  switch (rule.period.type) {
    case "calendar-year": {
      const byYear = groupBy(days, (date) => date.slice(0, 4));
      periods = Array.from(byYear.entries())
        .sort()
        .map(([year, group]) => buildPeriodResult(year, group, rule));
      break;
    }
    case "offset-year": {
      const start = rule.period.start;
      const byPeriod = groupBy(days, (date) => offsetYearLabel(date, start));
      periods = Array.from(byPeriod.entries())
        .sort()
        .map(([label, group]) =>
          buildPeriodResult(label, group, rule, `Year starting ${start}.`)
        );
      break;
    }
    case "rolling-window":
      periods = evaluateRollingWindow(days, rule, rule.period.windowDays);
      break;
    case "multi-year-weighted":
      periods = evaluateMultiYearWeighted(
        days,
        rule,
        rule.period.weights,
        rule.period.minCurrentYearDays
      );
      break;
  }

  return { rule, periods, disclaimer: DISCLAIMER };
}
