/**
 * Activity summary: where you've been, by year, with confidence split.
 * Counting is any-presence: a travel day counts for every country touched,
 * so per-country days in a year can sum to more than the year's length.
 */

import type { DayHistory, DayRecord } from "../types.ts";
import type { BuildStats } from "../presence/days.ts";

export interface CountryYearSummary {
  observed: number;
  inferred: number;
  total: number;
}

export interface YearSummary {
  year: string;
  daysInData: number;
  daysObserved: number;
  daysInferred: number;
  daysUnknown: number;
  /** Days with observations in 2+ countries. */
  travelDays: number;
  countries: Record<string, CountryYearSummary>;
}

export interface ActivitySummary {
  years: YearSummary[];
  totals: {
    daysObserved: number;
    daysInferred: number;
    daysUnknown: number;
    travelDays: number;
    countries: Record<string, CountryYearSummary>;
    lastObservedDay: string | null;
  };
  stats: BuildStats;
}

function countriesOf(record: DayRecord): string[] {
  const names = new Set<string>();
  for (const presence of record.regions) {
    names.add(presence.country);
  }
  return Array.from(names);
}

function bump(
  bucket: Record<string, CountryYearSummary>,
  country: string,
  status: "observed" | "inferred"
): void {
  const entry = bucket[country] ?? { observed: 0, inferred: 0, total: 0 };
  entry[status] += 1;
  entry.total += 1;
  bucket[country] = entry;
}

function sortCountries(
  bucket: Record<string, CountryYearSummary>
): Record<string, CountryYearSummary> {
  return Object.fromEntries(
    Object.entries(bucket).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
  );
}

export function summarize(history: DayHistory, stats: BuildStats): ActivitySummary {
  const byYear = new Map<string, YearSummary>();
  const totals: ActivitySummary["totals"] = {
    daysObserved: 0,
    daysInferred: 0,
    daysUnknown: 0,
    travelDays: 0,
    countries: {},
    lastObservedDay: null,
  };

  for (const record of Object.values(history)) {
    const year = record.date.slice(0, 4);
    let summary = byYear.get(year);
    if (!summary) {
      summary = {
        year,
        daysInData: 0,
        daysObserved: 0,
        daysInferred: 0,
        daysUnknown: 0,
        travelDays: 0,
        countries: {},
      };
      byYear.set(year, summary);
    }

    summary.daysInData += 1;
    if (record.status === "unknown") {
      summary.daysUnknown += 1;
      totals.daysUnknown += 1;
      continue;
    }

    const status = record.status;
    if (status === "observed") {
      summary.daysObserved += 1;
      totals.daysObserved += 1;
      if (!totals.lastObservedDay || record.date > totals.lastObservedDay) {
        totals.lastObservedDay = record.date;
      }
    } else {
      summary.daysInferred += 1;
      totals.daysInferred += 1;
    }

    const countries = countriesOf(record);
    if (countries.filter((c) => c !== "Unknown").length > 1) {
      summary.travelDays += 1;
      totals.travelDays += 1;
    }
    for (const country of countries) {
      bump(summary.countries, country, status);
      bump(totals.countries, country, status);
    }
  }

  const years = Array.from(byYear.values()).sort((a, b) => a.year.localeCompare(b.year));
  for (const year of years) {
    year.countries = sortCountries(year.countries);
  }
  totals.countries = sortCountries(totals.countries);

  return { years, totals, stats };
}
