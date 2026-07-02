import test from "node:test";
import assert from "node:assert/strict";
import { buildPresenceModel } from "../src/presence/days.ts";
import { createResolver } from "../src/geo/resolver.ts";
import { LANDMARKS, obs } from "./helpers.ts";

const resolve = createResolver();

test("a travel day keeps ALL regions, not a single winner", async () => {
  // Morning in San Juan, evening in NYC. The old design kept only the last
  // location; for presence tests this day must count for BOTH PR and US.
  const model = buildPresenceModel(
    [
      obs("2024-03-14T07:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-03-14T21:00:00.000-05:00", LANDMARKS.nycUS),
    ],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2025-01-01" }
  );

  const day = model.history["2024-03-14"]!;
  assert.equal(day.status, "observed");
  const countries = day.regions.map((r) => r.country).sort();
  assert.deepEqual(countries, ["Puerto Rico", "United States of America"]);
  assert.equal(day.endOfDayCountry, "United States of America");
});

test("gap between same-country days is inferred with graded confidence", () => {
  const model = buildPresenceModel(
    [
      obs("2024-03-01T12:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-03-12T12:00:00.000-04:00", LANDMARKS.sanJuanPR),
    ],
    resolve,
    { years: [2024], todayKey: "2025-01-01" }
  );
  const filled = model.history["2024-03-06"]!;
  assert.equal(filled.status, "inferred");
  assert.equal(filled.inference?.kind, "interpolate_between");
  assert.equal(filled.inference?.confidence, "medium"); // 10-day gap
  assert.equal(filled.regions[0]?.country, "Puerto Rico");
});

test("gap between different countries stays unknown", () => {
  const model = buildPresenceModel(
    [
      obs("2024-03-01T12:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-03-04T12:00:00.000+00:00", LANDMARKS.londonUK),
    ],
    resolve,
    { years: [2024], todayKey: "2025-01-01" }
  );
  assert.equal(model.history["2024-03-02"]!.status, "unknown");
  assert.equal(model.history["2024-03-03"]!.status, "unknown");
});

test("one-sided gaps are bounded by maxInferGapDays", () => {
  const model = buildPresenceModel(
    [obs("2024-01-10T12:00:00.000-04:00", LANDMARKS.sanJuanPR)],
    resolve,
    { years: [2024], maxInferGapDays: 3, todayKey: "2024-02-01" }
  );
  // 9 leading unknown days > 3 -> stay unknown.
  assert.equal(model.history["2024-01-01"]!.status, "unknown");
  // trailing gap 10th..Feb 1 also > 3.
  assert.equal(model.history["2024-01-20"]!.status, "unknown");
});

test("inference never bridges non-contiguous years", () => {
  // Regression guard (this bug shipped once in the v1 engine): with years
  // 2022 and 2024, Dec 2022 and Jan 2024 are NOT adjacent days.
  const model = buildPresenceModel(
    [
      obs("2022-12-30T12:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-01-02T12:00:00.000-04:00", LANDMARKS.sanJuanPR),
    ],
    resolve,
    { years: [2022, 2024], maxInferGapDays: 0, todayKey: "2025-01-01" }
  );
  assert.equal(model.history["2022-12-31"]!.status, "unknown");
  assert.equal(model.history["2024-01-01"]!.status, "unknown");
});

test("future days are excluded; day keys come from the timestamp's own offset", () => {
  const model = buildPresenceModel(
    // 23:30 UTC-4 on Mar 1 is Mar 2 in UTC; the local day (Mar 1) must win.
    [obs("2024-03-01T23:30:00.000-04:00", LANDMARKS.sanJuanPR)],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2024-03-05" }
  );
  assert.equal(model.history["2024-03-01"]!.status, "observed");
  assert.equal(model.history["2024-03-02"]!.status, "unknown");
  assert.equal(model.history["2024-03-06"], undefined);
  assert.equal(Object.keys(model.history).length, 65); // Jan 1 .. Mar 5
});

test("years default to those present in the data", () => {
  const model = buildPresenceModel(
    [
      obs("2023-06-01T12:00:00.000+00:00", LANDMARKS.londonUK),
      obs("2024-06-01T12:00:00.000+00:00", LANDMARKS.parisFR),
    ],
    resolve,
    { fillMissingDays: false, todayKey: "2025-01-01" }
  );
  assert.deepEqual(model.stats.yearsIncluded, [2023, 2024]);
  assert.equal(model.stats.daysTotal, 365 + 366); // 2023 + leap 2024
});
