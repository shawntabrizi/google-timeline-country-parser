/** Calendar-day key utilities. Day keys are YYYY-MM-DD strings. */

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** True for syntactically valid, real calendar dates ("2020-13-45" fails). */
export function isValidDayKey(key: string): boolean {
  if (!DAY_KEY_RE.test(key)) {
    return false;
  }
  const epoch = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(epoch)) {
    return false;
  }
  // Date.parse normalizes overflow (e.g. Feb 30 -> Mar 2); round-trip to catch it.
  return new Date(epoch).toISOString().slice(0, 10) === key;
}

/**
 * The local calendar day of an ISO timestamp, using the offset embedded in
 * the timestamp itself — i.e. the day it was where the record was made.
 */
export function dayKeyOfTimestamp(timestamp: string): string | null {
  const key = timestamp.slice(0, 10);
  return isValidDayKey(key) ? key : null;
}

/** Today's date in this machine's local timezone. */
export function todayKeyLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function dayKeyToEpochUtc(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

export function epochUtcToDayKey(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
  return epochUtcToDayKey(dayKeyToEpochUtc(key) + days * ONE_DAY_MS);
}

/** All day keys of a calendar year, in order. */
export function dayKeysForYear(year: number): string[] {
  const keys: string[] = [];
  let epoch = Date.parse(`${year}-01-01T00:00:00Z`);
  const end = Date.parse(`${year + 1}-01-01T00:00:00Z`);
  while (epoch < end) {
    keys.push(epochUtcToDayKey(epoch));
    epoch += ONE_DAY_MS;
  }
  return keys;
}

/** Inclusive range of day keys. */
export function dayKeysBetween(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  let epoch = dayKeyToEpochUtc(startKey);
  const end = dayKeyToEpochUtc(endKey);
  while (epoch <= end) {
    keys.push(epochUtcToDayKey(epoch));
    epoch += ONE_DAY_MS;
  }
  return keys;
}

/** Split ordered day keys into runs of consecutive calendar days. */
export function splitIntoContiguousRuns(dayKeys: string[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  let prevEpoch: number | null = null;
  for (const day of dayKeys) {
    const epoch = dayKeyToEpochUtc(day);
    if (prevEpoch !== null && epoch - prevEpoch !== ONE_DAY_MS) {
      runs.push(run);
      run = [];
    }
    run.push(day);
    prevEpoch = epoch;
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}
