import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKeysForYear,
  isValidDayKey,
  splitIntoContiguousRuns,
} from "../src/dates.ts";
import { parseYearsInput } from "../src/years.ts";

test("impossible dates are rejected, not normalized", () => {
  assert.equal(isValidDayKey("2024-02-29"), true); // leap
  assert.equal(isValidDayKey("2023-02-29"), false);
  assert.equal(isValidDayKey("2024-13-45"), false);
});

test("year day keys handle leap years", () => {
  assert.equal(dayKeysForYear(2024).length, 366);
  assert.equal(dayKeysForYear(2023).length, 365);
});

test("contiguous runs split at calendar gaps", () => {
  const runs = splitIntoContiguousRuns([
    "2022-12-30",
    "2022-12-31",
    "2024-01-01", // 2023 missing entirely
    "2024-01-02",
  ]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], ["2022-12-30", "2022-12-31"]);
});

test("years input parses lists, ranges, and rejects nonsense", () => {
  assert.deepEqual(parseYearsInput("2021, 2020-2022,2020"), [2020, 2021, 2022]);
  assert.throws(() => parseYearsInput("2022-2020"), /Start year/);
  assert.throws(() => parseYearsInput("202x"), /Invalid year/);
});
