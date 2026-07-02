import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractObservations } from "../src/ingest/timeline.ts";
import { loadArchive, mergeIntoArchive } from "../src/ingest/archive.ts";
import { parseCoordinate } from "../src/ingest/coordinates.ts";

test("extracts observations from all supported export shapes", () => {
  const exportJson = {
    semanticSegments: [
      {
        startTime: "2024-03-01T08:00:00.000-04:00",
        endTime: "2024-03-02T01:00:00.000-04:00",
        visit: { topCandidate: { placeLocation: { latLng: "18.4655°, -66.1057°" } } },
      },
      {
        startTime: "2024-03-03T09:00:00.000-04:00",
        endTime: "2024-03-03T15:00:00.000-04:00",
        activity: {
          start: { latLng: "18.4655°, -66.1057°" },
          end: { latLng: "40.7128°, -74.0060°" },
        },
      },
      {
        startTime: "2024-03-04T01:00:00.000-05:00",
        endTime: "2024-03-04T02:00:00.000-05:00",
        timelinePath: [
          { point: "40.7128°, -74.0060°", time: "2024-03-04T01:15:00.000-05:00" },
          { point: "40.7500°, -74.0000°" }, // no time -> falls back to segment start
        ],
      },
    ],
    rawSignals: [
      {
        position: {
          LatLng: "40.7128°, -74.0060°",
          timestamp: "2024-03-05T10:00:00.000-05:00",
        },
      },
      { wifiScan: { deliveryTime: "2024-03-05T10:00:00.000-05:00" } },
    ],
  };

  const { observations, stats } = extractObservations(exportJson);
  // visit start+end, activity start+end, 2 path nodes, 1 raw position = 7
  assert.equal(observations.length, 7);
  assert.equal(stats.rawPositionSignals, 1);
  assert.equal(stats.malformedEntries, 0);
  // A visit spanning midnight evidences presence on BOTH days.
  const visitDays = observations
    .filter((o) => o.source.startsWith("visit"))
    .map((o) => o.time.slice(0, 10));
  assert.deepEqual(visitDays, ["2024-03-01", "2024-03-02"]);
});

test("malformed entries are counted, never crash", () => {
  const { observations, stats } = extractObservations({
    semanticSegments: [
      {
        startTime: "2024-03-01T08:00:00.000Z",
        endTime: "2024-03-01T09:00:00.000Z",
        visit: { topCandidate: { placeLocation: { latLng: "not-a-point" } } },
      },
      { startTime: "bogus", timelinePath: [{ foo: "bar" }] },
      null,
    ],
  });
  assert.equal(observations.length, 0);
  assert.equal(stats.malformedEntries > 0, true);
});

test("rejects input that is not a timeline export", () => {
  assert.throws(() => extractObservations({ hello: "world" }), /Timeline export/);
});

test("coordinate parsing handles string, object, and E7 shapes", () => {
  assert.deepEqual(parseCoordinate("18.4655°, -66.1057°"), { lat: 18.4655, lng: -66.1057 });
  assert.deepEqual(parseCoordinate({ lat: 1, lng: 2 }), { lat: 1, lng: 2 });
  assert.deepEqual(parseCoordinate({ latitudeE7: 184655000, longitudeE7: -661057000 }), {
    lat: 18.4655,
    lng: -66.1057,
  });
  assert.equal(parseCoordinate("91.0°, 0.0°"), null); // out of range
  assert.equal(parseCoordinate(undefined), null);
});

test("archive merge is idempotent and splits by year", () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-archive-"));
  try {
    const observations = [
      { time: "2023-12-31T23:00:00.000+00:00", lat: 1, lng: 2, source: "visit_end" as const },
      { time: "2024-01-01T01:00:00.000+00:00", lat: 1, lng: 2, source: "visit_end" as const },
    ];
    const first = mergeIntoArchive(dir, observations);
    assert.equal(first.added, 2);
    const second = mergeIntoArchive(dir, observations);
    assert.equal(second.added, 0);
    assert.equal(second.duplicates, 2);

    assert.equal(loadArchive(dir).length, 2);
    assert.equal(loadArchive(dir, [2024]).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
