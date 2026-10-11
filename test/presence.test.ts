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

test("countries merely flown over never appear in the day's regions", () => {
  // SJU -> NYC flight: the path fix over central Cuba implies ~860 km/h
  // legs — airborne. Cuba is overflight, not presence, and must be absent
  // from the output entirely. PR and US keep their ground evidence.
  const centralCuba = { lat: 22.0, lng: -78.6 };
  const model = buildPresenceModel(
    [
      obs("2024-03-14T08:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-03-14T14:00:00.000-04:00", LANDMARKS.sanJuanPR),
      obs("2024-03-14T15:30:00.000-04:00", centralCuba, "timeline_path"),
      obs("2024-03-14T18:30:00.000-04:00", LANDMARKS.nycUS),
      obs("2024-03-14T21:00:00.000-04:00", LANDMARKS.nycUS),
    ],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const day = model.history["2024-03-14"]!;
  const countries = day.regions.map((r) => r.country).sort();
  assert.deepEqual(countries, ["Puerto Rico", "United States of America"]);
});

test("Google-labeled airborne fixes are excluded even at ground speeds", () => {
  // Paris -> Brussels over 11 hours (~24 km/h implied): the speed heuristic
  // stays silent, so ONLY the ingest-time FLYING flag can exclude Belgium.
  const model = buildPresenceModel(
    [
      obs("2024-03-14T08:00:00.000+01:00", LANDMARKS.parisFR),
      obs("2024-03-14T09:00:00.000+01:00", LANDMARKS.parisFR),
      { ...obs("2024-03-14T20:00:00.000+01:00", { lat: 50.85, lng: 4.35 }), airborne: true },
    ],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const day = model.history["2024-03-14"]!;
  assert.deepEqual(day.regions.map((r) => r.country), ["France"]);
});

test("a day with only airborne fixes has no presence at all", () => {
  const model = buildPresenceModel(
    [{ ...obs("2024-03-14T12:00:00.000+00:00", LANDMARKS.parisFR), airborne: true }],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  assert.equal(model.history["2024-03-14"]!.status, "unknown");
  assert.deepEqual(model.history["2024-03-14"]!.regions, []);
});

test("fast ground travel is not mistaken for flying", () => {
  // ~230 km in 1h = high-speed rail; both ends must count.
  const model = buildPresenceModel(
    [
      obs("2024-03-14T08:00:00.000+01:00", LANDMARKS.parisFR),
      obs("2024-03-14T09:00:00.000+01:00", { lat: 50.63, lng: 3.07 }), // Lille
    ],
    resolve,
    { years: [2024], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const day = model.history["2024-03-14"]!;
  assert.deepEqual(day.regions.map((r) => r.country), ["France"]);
  assert.equal(day.regions[0]?.observationCount, 2);
});

test("the endpoints of one fast leg are airports, not overflight", () => {
  // Sparse raw fixes: New York late evening, London after landing. The leg
  // between them is flight-speed, but each fix is where the person stood on
  // the ground. Dropping them would erase a departure day and an arrival day
  // from the presence count.
  // Slow neighbors on both sides, so the endpoints are interior fixes and
  // the two-sided rule (not the array edges) is what keeps them.
  const model = buildPresenceModel(
    [
      obs("2010-11-20T21:00:00.000-05:00", LANDMARKS.nycUS, "raw_position"),
      obs("2010-11-20T23:00:00.000-05:00", LANDMARKS.nycUS, "raw_position"),
      obs("2010-11-21T11:00:00.000+00:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-11-21T13:00:00.000+00:00", LANDMARKS.londonUK, "raw_position"),
    ],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  assert.deepEqual(
    model.history["2010-11-20"]!.regions.map((r) => r.country),
    ["United States of America"]
  );
  assert.deepEqual(model.history["2010-11-21"]!.regions.map((r) => r.country), ["United Kingdom"]);
});

test("a stale fix that teleports away and back is still dropped", () => {
  // Home -> 6,000 km away -> home within minutes: both legs are fast, so the
  // middle fix is an artifact. Its region must not appear.
  const model = buildPresenceModel(
    [
      obs("2010-03-14T10:00:00.000+00:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-03-14T10:05:00.000+00:00", LANDMARKS.nycUS, "raw_position"),
      obs("2010-03-14T10:10:00.000+00:00", LANDMARKS.londonUK, "raw_position"),
    ],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  assert.deepEqual(model.history["2010-03-14"]!.regions.map((r) => r.country), ["United Kingdom"]);
});

test("days follow the place's local calendar, not the export's offset", () => {
  // A 21:30 arrival in San Juan, as labeled by an export made in a +07:00 zone
  // (+07:00 renders it as 08:30 the next morning). PR presence belongs to
  // the PR-local date; the text date would move it a day later.
  const model = buildPresenceModel(
    [obs("2010-11-09T08:30:00.000+07:00", LANDMARKS.sanJuanPR)],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  assert.equal(model.history["2010-11-08"]!.status, "observed");
  assert.equal(model.history["2010-11-09"]!.status, "unknown");

  // The UTC boundary (used only for sensitivity checks) puts it on the 9th.
  const utc = buildPresenceModel(
    [obs("2010-11-09T08:30:00.000+07:00", LANDMARKS.sanJuanPR)],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01", dayBoundary: "utc" }
  );
  assert.equal(utc.history["2010-11-09"]!.status, "observed");
});

test("a local New Year's Eve stays in the old year", () => {
  // 22:00 on Dec 31 in San Juan is already Jan 1 in UTC and in most export
  // zones; the year filter must apply to the local date.
  const model = buildPresenceModel(
    [obs("2011-01-01T02:00:00.000+00:00", LANDMARKS.sanJuanPR)],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2011-06-01" }
  );
  assert.equal(model.history["2010-12-31"]!.status, "observed");
});

// Berlin -> London flight with in-flight raw fixes over the Netherlands.
const overNetherlandsA = { lat: 52.2, lng: 5.5 };
const overNetherlandsB = { lat: 52.25, lng: 5.2 }; // ~21 km and 2 min later

test("dense in-flight fixes are still overflight", () => {
  // Two in-flight fixes 2 minutes apart are near each other; that short leg
  // must not break the flight and let the overflown country count.
  const model = buildPresenceModel(
    [
      obs("2010-06-01T09:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T10:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T11:00:00.000+02:00", overNetherlandsA, "raw_position"),
      obs("2010-06-01T11:02:00.000+02:00", overNetherlandsB, "raw_position"),
      obs("2010-06-01T10:45:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-06-01T12:00:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
    ],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const countries = model.history["2010-06-01"]!.regions.map((r) => r.country).sort();
  assert.deepEqual(countries, ["Germany", "United Kingdom"]);
});

test("an in-flight fix stored twice at the same instant is still overflight", () => {
  // Two export structures can carry the same fix; a zero-length, zero-time
  // leg between the copies must not read as "slow".
  const model = buildPresenceModel(
    [
      obs("2010-06-01T09:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T10:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T11:00:00.000+02:00", overNetherlandsA, "raw_position"),
      obs("2010-06-01T11:00:00.000+02:00", overNetherlandsA, "timeline_path"),
      obs("2010-06-01T10:45:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-06-01T12:00:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
    ],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const countries = model.history["2010-06-01"]!.regions.map((r) => r.country).sort();
  assert.deepEqual(countries, ["Germany", "United Kingdom"]);
});

test("a layover airport keeps its presence between two flights", () => {
  // Berlin -> London (layover) -> New York. The London fixes are reached and
  // left at flight speed, but they dwell in place: the person was there.
  const model = buildPresenceModel(
    [
      obs("2010-06-01T08:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T09:00:00.000+02:00", LANDMARKS.berlinDE, "raw_position"),
      obs("2010-06-01T09:45:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-06-01T10:15:00.000+01:00", LANDMARKS.londonUK, "raw_position"),
      obs("2010-06-01T15:00:00.000-04:00", LANDMARKS.nycUS, "raw_position"),
      obs("2010-06-01T16:00:00.000-04:00", LANDMARKS.nycUS, "raw_position"),
    ],
    resolve,
    { years: [2010], fillMissingDays: false, todayKey: "2025-01-01" }
  );
  const countries = model.history["2010-06-01"]!.regions.map((r) => r.country).sort();
  assert.deepEqual(countries, ["Germany", "United Kingdom", "United States of America"]);
});
