/**
 * Local observation archive: append-only JSONL, one file per year.
 *
 * Why: Google stores Timeline data only on the phone. Periodic exports are
 * the backup, and each export overlaps the previous ones. Merging them into
 * a deduplicated archive gives a durable, growing source of truth that
 * survives device loss and export quirks. Re-ingesting the same export is a
 * no-op.
 *
 * Privacy: archives contain raw location history. They are written outside
 * version control (gitignored) and must never be committed or uploaded.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Observation } from "../types.ts";

/**
 * Keyed by the instant, not the timestamp text: each export renders times in
 * the phone's zone at export time, so the same fix arrives as
 * "...T10:00+07:00" in one export and "...T03:00+00:00" in the next.
 */
function dedupeKey(observation: Observation): string {
  return [
    Date.parse(observation.time),
    observation.lat.toFixed(5),
    observation.lng.toFixed(5),
    observation.source,
  ].join("|");
}

function fileForYear(dir: string, year: string): string {
  return join(dir, `observations-${year}.jsonl`);
}

export interface MergeResult {
  added: number;
  duplicates: number;
  invalid: number;
}

export function mergeIntoArchive(dir: string, observations: Observation[]): MergeResult {
  mkdirSync(dir, { recursive: true });

  const existing = new Set<string>();
  for (const stored of readArchive(dir)) {
    existing.add(dedupeKey(stored));
  }

  const byYear = new Map<string, string[]>();
  const result: MergeResult = { added: 0, duplicates: 0, invalid: 0 };

  for (const observation of observations) {
    const epoch = Date.parse(observation.time);
    if (!Number.isFinite(epoch)) {
      result.invalid += 1;
      continue;
    }
    const key = dedupeKey(observation);
    if (existing.has(key)) {
      result.duplicates += 1;
      continue;
    }
    existing.add(key);
    result.added += 1;
    // Files are bucketed by UTC year; loaders read neighbor years too.
    const year = new Date(epoch).toISOString().slice(0, 4);
    const lines = byYear.get(year) ?? [];
    lines.push(JSON.stringify(observation));
    byYear.set(year, lines);
  }

  for (const [year, lines] of byYear) {
    appendFileSync(fileForYear(dir, year), lines.join("\n") + "\n");
  }

  return result;
}

/**
 * Observations for the given years (all when omitted), deduplicated by
 * instant. Neighbor-year files are included because a file's year is not the
 * local calendar year of every fix in it (archives written by older versions
 * bucketed by export-zone text; new writes bucket by UTC). The presence model
 * applies the exact year filter after deriving local days.
 */
export function loadArchive(dir: string, years?: number[]): Observation[] {
  const expanded = years?.flatMap((year) => [year - 1, year, year + 1]);
  const seen = new Set<string>();
  return readArchive(dir, expanded).filter((observation) => {
    const key = dedupeKey(observation);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readArchive(dir: string, years?: number[]): Observation[] {
  if (!existsSync(dir)) {
    return [];
  }
  const wanted = years ? new Set(years.map(String)) : null;
  const observations: Observation[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const match = entry.match(/^observations-(\d{4})\.jsonl$/);
    if (!match || (wanted && !wanted.has(match[1]!))) {
      continue;
    }
    const content = readFileSync(join(dir, entry), "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      observations.push(JSON.parse(line) as Observation);
    }
  }
  return observations;
}
