/**
 * Rules engine + preset test vectors. Presets carry legal weight: every
 * preset gets vectors proving its counting semantics, not just "it runs".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRule } from "../src/rules/engine.ts";
import { loadPresets, loadRule } from "../src/rules/presets.ts";
import {
  FR,
  PR,
  UK,
  US,
  fillYear,
  historyOf,
  inferredDay,
  observedDay,
  presence,
  unknownDay,
} from "./helpers.ts";

test("all presets load and validate", () => {
  const presets = loadPresets();
  const ids = presets.map((p) => p.id);
  assert.deepEqual(ids.sort(), [
    "act60-pr-183",
    "pr-presence-549-3yr",
    "schengen-90-180",
    "uk-srt-183",
    "us-substantial-presence",
  ]);
});

// --- act60-pr-183 ---

test("act60: exactly 183 observed PR days passes; 182 fails", () => {
  const rule = loadRule("act60-pr-183");
  const pass = evaluateRule(historyOf(fillYear(2024, PR, 1, 183)), rule);
  assert.equal(pass.periods[0]?.observedDays, 183);
  assert.equal(pass.periods[0]?.satisfiedObserved, true);

  const fail = evaluateRule(historyOf(fillYear(2024, PR, 1, 182)), rule);
  assert.equal(fail.periods[0]?.satisfiedObserved, false);
});

test("act60: a PR->US travel day still counts as a PR day (any-presence)", () => {
  const rule = loadRule("act60-pr-183");
  const history = historyOf([
    ...fillYear(2024, PR, 1, 182),
    // Day 183: left PR in the morning — ends the day in the US.
    observedDay("2024-07-01", [PR(), US()], "United States of America"),
  ]);
  const result = evaluateRule(history, rule);
  assert.equal(result.periods[0]?.observedDays, 183);
  assert.equal(result.periods[0]?.satisfiedObserved, true);
});

test("act60: inferred days are reported separately from observed", () => {
  const rule = loadRule("act60-pr-183");
  const history = historyOf([
    ...fillYear(2024, PR, 1, 180),
    inferredDay("2024-06-29", PR()),
    inferredDay("2024-06-30", PR()),
    inferredDay("2024-07-01", PR()),
    unknownDay("2024-07-02"),
  ]);
  const result = evaluateRule(history, rule);
  const period = result.periods[0]!;
  assert.equal(period.observedDays, 180);
  assert.equal(period.inferredDays, 3);
  assert.equal(period.satisfiedObserved, false); // 180 < 183: not defensible
  assert.equal(period.satisfiedWithInferred, true); // 183 with inference
  assert.equal(period.unknownDays, 1);
});

// --- us-substantial-presence ---

test("SPT: weighted 3-year formula with 31-day current minimum", () => {
  const rule = loadRule("us-substantial-presence");
  // 130 + 120/3 + 120/6 = 130 + 40 + 20 = 190 >= 183 -> pass
  const history = historyOf([
    ...fillYear(2022, US, 1, 120),
    ...fillYear(2023, US, 1, 120),
    ...fillYear(2024, US, 1, 130),
  ]);
  const result = evaluateRule(history, rule);
  const y2024 = result.periods.find((p) => p.period === "2024")!;
  assert.equal(Math.round(y2024.observedDays), 190);
  assert.equal(y2024.satisfiedObserved, true);

  // 120 + 40 + 20 = 180 < 183 -> fail
  const y2023 = result.periods.find((p) => p.period === "2023")!;
  assert.equal(y2023.satisfiedObserved, false);
});

test("SPT: Puerto Rico days do NOT count (territories excluded, exact match)", () => {
  const rule = loadRule("us-substantial-presence");
  const history = historyOf(fillYear(2024, PR, 1, 200));
  const result = evaluateRule(history, rule);
  assert.equal(result.periods.find((p) => p.period === "2024")?.observedDays, 0);
});

test("SPT: 200 weighted days but under 31 current-year days fails", () => {
  const rule = loadRule("us-substantial-presence");
  const history = historyOf([
    ...fillYear(2023, US, 1, 340), // /3 -> 113.3
    ...fillYear(2022, US, 1, 340), // /6 -> 56.7
    ...fillYear(2024, US, 1, 30), // 30 < 31 minimum
  ]);
  const result = evaluateRule(history, rule);
  const y2024 = result.periods.find((p) => p.period === "2024")!;
  assert.equal(y2024.observedDays >= 183, true);
  assert.equal(y2024.satisfiedObserved, false);
});

// --- uk-srt-183 ---

test("UK SRT: counts midnights, not any-presence", () => {
  const rule = loadRule("uk-srt-183");
  const history = historyOf([
    // In the UK during the day but ends it in France: does NOT count.
    observedDay("2024-06-01", [UK(), FR()], "France"),
    // Ends the day in the UK: counts.
    observedDay("2024-06-02", [FR(), UK()], "United Kingdom"),
  ]);
  const result = evaluateRule(history, rule);
  const period = result.periods.find((p) => p.period === "2024/25")!;
  assert.equal(period.observedDays, 1);
});

test("UK SRT: tax year boundary is April 6", () => {
  const rule = loadRule("uk-srt-183");
  const history = historyOf([
    observedDay("2024-04-05", [UK()]),
    observedDay("2024-04-06", [UK()]),
  ]);
  const result = evaluateRule(history, rule);
  assert.equal(result.periods.find((p) => p.period === "2023/24")?.observedDays, 1);
  assert.equal(result.periods.find((p) => p.period === "2024/25")?.observedDays, 1);
});

// --- schengen-90-180 ---

test("Schengen: 90 days in a window passes, 91 fails (at-most)", () => {
  const rule = loadRule("schengen-90-180");

  const ninety = historyOf(fillYear(2024, FR, 1, 90));
  const okay = evaluateRule(ninety, rule);
  const peakOk = okay.periods.find((p) => p.period.startsWith("peak"))!;
  assert.equal(peakOk.observedDays, 90);
  assert.equal(peakOk.satisfiedObserved, true);

  const ninetyOne = historyOf(fillYear(2024, FR, 1, 91));
  const violated = evaluateRule(ninetyOne, rule);
  const peakBad = violated.periods.find((p) => p.period.startsWith("peak"))!;
  assert.equal(peakBad.satisfiedObserved, false);
});

test("Schengen: days spread wider than the 180-day window do not accumulate", () => {
  const rule = loadRule("schengen-90-180");
  // 60 days in January-February, 60 days in October: never 91 in one window.
  const history = historyOf([
    ...fillYear(2024, FR, 1, 60),
    ...fillYear(2024, FR, 275, 60),
  ]);
  const result = evaluateRule(history, rule);
  const peak = result.periods.find((p) => p.period.startsWith("peak"))!;
  assert.equal(peak.satisfiedObserved, true);
  assert.equal(peak.observedDays <= 90, true);
});

// --- pr-presence-549-3yr ---

test("PR 549/3yr: three 183-day years pass; requires 60 current-year days", () => {
  const rule = loadRule("pr-presence-549-3yr");
  const history = historyOf([
    ...fillYear(2022, PR, 1, 183),
    ...fillYear(2023, PR, 1, 183),
    ...fillYear(2024, PR, 1, 183),
  ]);
  const result = evaluateRule(history, rule);
  const y2024 = result.periods.find((p) => p.period === "2024")!;
  assert.equal(y2024.observedDays, 549);
  assert.equal(y2024.satisfiedObserved, true);

  const thin = historyOf([
    ...fillYear(2022, PR, 1, 300),
    ...fillYear(2023, PR, 1, 300),
    ...fillYear(2024, PR, 1, 50), // 650 total but < 60 in current year
  ]);
  const thinResult = evaluateRule(thin, rule);
  assert.equal(thinResult.periods.find((p) => p.period === "2024")?.satisfiedObserved, false);
});

// --- generic engine behavior ---

test("unknown days never count for any rule", () => {
  const rule = loadRule("act60-pr-183");
  const history = historyOf([observedDay("2024-01-01", [PR()]), unknownDay("2024-01-02")]);
  const result = evaluateRule(history, rule);
  assert.equal(result.periods[0]?.observedDays, 1);
  assert.equal(result.periods[0]?.unknownDays, 1);
});

test("custom rule files load and validate with clear errors", () => {
  assert.throws(
    () => loadRule("does-not-exist"),
    /Unknown rule 'does-not-exist'. Built-in presets:/
  );
});

// --- incomplete verdicts: formulas must not silently treat unloaded years as 0 ---

test("multi-year test marks FAIL as INCOMPLETE when prior years are not loaded", () => {
  const rule = loadRule("pr-presence-549-3yr");
  // Only 2024 loaded: 200 days < 549. With 2022-2023 loaded this could pass,
  // so the FAIL is untrustworthy and must be flagged.
  const result = evaluateRule(historyOf(fillYear(2024, PR, 1, 200)), rule);
  const y2024 = result.periods.find((p) => p.period === "2024")!;
  assert.equal(y2024.satisfiedObserved, false);
  assert.equal(y2024.incomplete, true);
  assert.deepEqual(y2024.missingYears, ["2023", "2022"]);
  assert.match(y2024.detail ?? "", /not loaded/);
});

test("multi-year PASS with missing years stays a trustworthy PASS", () => {
  // Missing years can only ADD days to an at-least test: a PASS cannot flip.
  const rule = loadRule("pr-presence-549-3yr");
  const result = evaluateRule(historyOf(fillYear(2024, PR, 1, 300)), rule);
  // 300 < 549 -> still fails; use a custom threshold via SPT instead:
  const spt = loadRule("us-substantial-presence");
  const sptResult = evaluateRule(historyOf(fillYear(2024, US, 1, 200)), spt);
  const y2024 = sptResult.periods.find((p) => p.period === "2024")!;
  assert.equal(y2024.satisfiedObserved, true); // 200 >= 183 on current year alone
  assert.notEqual(y2024.incomplete, true); // missing 2022/2023 cannot flip a PASS
  assert.deepEqual(y2024.missingYears, ["2023", "2022"]);
  void result;
});

test("multi-year test with all referenced years loaded is never incomplete", () => {
  const rule = loadRule("pr-presence-549-3yr");
  const history = historyOf([
    ...fillYear(2022, PR, 1, 183),
    ...fillYear(2023, PR, 1, 183),
    ...fillYear(2024, PR, 1, 183),
  ]);
  const result = evaluateRule(history, rule);
  const y2024 = result.periods.find((p) => p.period === "2024")!;
  assert.equal(y2024.incomplete, undefined);
  assert.equal(y2024.missingYears, undefined);
});

test("rolling window PASS is INCOMPLETE when the window predates loaded data", () => {
  const rule = loadRule("schengen-90-180");
  // 30 France days at the start of the loaded span: the latest 180-day
  // window reaches before the first loaded day, so an at-most PASS could
  // flip if earlier days were loaded.
  const result = evaluateRule(historyOf(fillYear(2024, FR, 1, 30)), rule);
  const latest = result.periods.find((p) => p.period.startsWith("latest"))!;
  assert.equal(latest.satisfiedObserved, true);
  assert.equal(latest.incomplete, true);
  assert.match(latest.detail ?? "", /before the first loaded day/);
});

// --- partial calendar periods: an unfinished year is not a FAIL ---

test("act60: a year still in progress below the threshold is incomplete, not FAIL", () => {
  // 150 PR days by the end of September; 92 days of the year remain. A plain
  // FAIL would be wrong: the year can still pass.
  const rule = loadRule("act60-pr-183");
  const records = [...fillYear(2024, PR, 1, 150), ...fillYear(2024, US, 151, 124)];
  const partial = evaluateRule(historyOf(records), rule).periods[0]!;
  assert.equal(partial.observedDays, 150);
  assert.equal(partial.satisfiedObserved, false);
  assert.equal(partial.missingDays, 366 - 274);
  assert.equal(partial.incomplete, true);
});

test("act60: a partial year already over the threshold is a plain PASS", () => {
  const rule = loadRule("act60-pr-183");
  const period = evaluateRule(historyOf(fillYear(2024, PR, 1, 200)), rule).periods[0]!;
  assert.equal(period.satisfiedObserved, true);
  assert.equal(period.incomplete, undefined);
});

test("act60: a partial year that can no longer pass is a plain FAIL", () => {
  // 10 PR days and 300 US days: even if all 56 remaining days were PR, the
  // year ends at 66. The verdict is settled.
  const rule = loadRule("act60-pr-183");
  const records = [...fillYear(2024, PR, 1, 10), ...fillYear(2024, US, 11, 300)];
  const period = evaluateRule(historyOf(records), rule).periods[0]!;
  assert.equal(period.satisfiedObserved, false);
  assert.equal(period.incomplete, undefined);
});

test("act60: unknown days that could reach the threshold make a FAIL incomplete", () => {
  const rule = loadRule("act60-pr-183");
  const records = [
    ...fillYear(2024, PR, 1, 180),
    ...Array.from({ length: 186 }, (_, i) =>
      unknownDay(new Date(Date.UTC(2024, 0, 181 + i)).toISOString().slice(0, 10))
    ),
  ];
  const period = evaluateRule(historyOf(records), rule).periods[0]!;
  assert.equal(period.unknownDays, 186);
  assert.equal(period.missingDays, undefined);
  assert.equal(period.incomplete, true);
});

test("uk-srt: a tax year that starts before the data is incomplete", () => {
  // Data from 2024-01-01: the 2023/24 UK tax year (from 04-06) is only
  // partly loaded and must not read as a FAIL with a handful of days.
  const rule = loadRule("uk-srt-183");
  const period = evaluateRule(historyOf(fillYear(2024, UK, 1, 60)), rule).periods.find(
    (p) => p.period === "2023/24"
  )!;
  assert.equal(period.missingDays! > 0, true);
  assert.equal(period.incomplete, true);
});

// --- day-boundary sensitivity ---

test("dates counted under only one day boundary are reported, with the alternate verdict", () => {
  // Local days: 183 PR days (an evening arrival counts on its local date).
  // UTC days: that arrival moves to the next day, already a PR day: 182.
  const rule = loadRule("act60-pr-183");
  const local = [...fillYear(2024, PR, 1, 183), ...fillYear(2024, US, 184, 183)];
  const utc = [
    ...fillYear(2024, US, 1, 1),
    ...fillYear(2024, PR, 2, 182),
    ...fillYear(2024, US, 184, 183),
  ];
  const period = evaluateRule(historyOf(local), rule, historyOf(utc)).periods[0]!;
  assert.equal(period.satisfiedObserved, true);
  assert.deepEqual(period.boundary, {
    observedDays: 182,
    satisfiedObserved: false,
    dates: ["2024-01-01"],
  });
});

test("no boundary note when both boundaries count the same dates", () => {
  const rule = loadRule("act60-pr-183");
  const history = historyOf(fillYear(2024, PR));
  const period = evaluateRule(history, rule, history).periods[0]!;
  assert.equal(period.boundary, undefined);
});

// --- territories: exact matching for UK and Schengen ---

const JERSEY = () => presence("Jersey", ["GBR", "JEY"]);
const REUNION = () => presence("Réunion", ["FRA", "REU"]);
const ALAND = () => presence("Åland Islands", ["FIN", "ALA"]);

test("UK SRT: Crown Dependency nights are not UK nights", () => {
  // Jersey resolves with its owner's code first; with any-code matching it
  // counted as UK and could turn a 120-night year into a false PASS.
  const rule = loadRule("uk-srt-183");
  const history = historyOf([
    observedDay("2024-06-01", [JERSEY()]),
    observedDay("2024-06-02", [UK()]),
  ]);
  const period = evaluateRule(history, rule).periods.find((p) => p.period === "2024/25")!;
  assert.equal(period.observedDays, 1);
});

test("Schengen: overseas territories do not count; Åland does", () => {
  // Réunion is French but outside Schengen: counting it gave false FAILs.
  // Åland is Finnish and inside Schengen, and carries its own code.
  const rule = loadRule("schengen-90-180");
  const history = historyOf([
    observedDay("2024-03-01", [REUNION()]),
    observedDay("2024-03-02", [ALAND()]),
    observedDay("2024-03-03", [FR()]),
  ]);
  const peak = evaluateRule(history, rule).periods.find((p) => p.period.startsWith("peak"))!;
  assert.equal(peak.observedDays, 2);
});

// --- rolling windows: observed and with-inferred peaks are separate ---

test("Schengen: the observed verdict uses the window with the most observed days", () => {
  // Jan-Mar: 91 observed days (a violation). Later: 85 observed + 10
  // inferred = 95 total. Picking the peak by total hid the observed
  // violation and printed "observed 85 -> PASS".
  const rule = loadRule("schengen-90-180");
  const records = [...fillYear(2024, FR, 1, 91)];
  for (let i = 0; i < 95; i += 1) {
    const date = new Date(Date.UTC(2024, 0, 201 + i)).toISOString().slice(0, 10);
    records.push(i < 85 ? observedDay(date, [FR()]) : inferredDay(date, FR()));
  }
  const periods = evaluateRule(historyOf(records), rule).periods;
  const observedPeak = periods.find((p) => p.period.endsWith("(observed)"))!;
  assert.equal(observedPeak.observedDays, 91);
  assert.equal(observedPeak.satisfiedObserved, false);
  const totalPeak = periods.find((p) => p.period.endsWith("(with inferred)"))!;
  assert.equal(totalPeak.totalDays, 95);
  assert.equal(totalPeak.satisfiedWithInferred, false);
});

test("rolling windows: equal observed peaks prefer the one with more inferred days", () => {
  // Two windows with 80 observed days; the later also has 5 inferred. The
  // observed peak should be the later one, so a single peak period covers
  // both verdicts instead of splitting into two.
  const rule = loadRule("schengen-90-180");
  const records = [...fillYear(2024, FR, 1, 80)];
  for (let i = 0; i < 85; i += 1) {
    const date = new Date(Date.UTC(2024, 0, 201 + i)).toISOString().slice(0, 10);
    records.push(i < 80 ? observedDay(date, [FR()]) : inferredDay(date, FR()));
  }
  const peaks = evaluateRule(historyOf(records), rule).periods.filter((p) =>
    p.period.startsWith("peak")
  );
  assert.equal(peaks.length, 1);
  assert.equal(peaks[0]!.observedDays, 80);
  assert.equal(peaks[0]!.totalDays, 85);
});
