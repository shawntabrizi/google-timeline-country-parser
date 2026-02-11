"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTimeline } = require("../src/timeline-parser");

function fakeCountryResolver({ lat, preferredCountry }) {
  let country = "Unknown";
  if (lat < 15) {
    country = "Country A";
  } else if (lat < 25) {
    country = "Country B";
  } else if (lat < 35) {
    country = "Country C";
  }

  if (preferredCountry && preferredCountry === country) {
    return { country, codes: ["PREFERRED"] };
  }
  return { country, codes: [] };
}

test("parseTimeline supports visit/activity/timelinePath and fills missing days", () => {
  const timeline = {
    semanticSegments: [
      {
        startTime: "2020-01-02T08:00:00.000+00:00",
        endTime: "2020-01-02T09:00:00.000+00:00",
        visit: {
          topCandidate: {
            placeLocation: {
              latLng: "10.0°, 10.0°",
            },
          },
        },
      },
      {
        startTime: "2020-01-02T10:00:00.000+00:00",
        endTime: "2020-01-02T18:00:00.000+00:00",
        activity: {
          start: { latLng: "20.0°, 20.0°" },
          end: { latLng: "30.0°, 30.0°" },
        },
      },
      {
        startTime: "2020-01-03T01:00:00.000+00:00",
        endTime: "2020-01-03T02:00:00.000+00:00",
        timelinePath: [
          { point: "20.0°, 20.0°", time: "2020-01-03T01:15:00.000+00:00" },
          { point: "30.0°, 30.0°", time: "2020-01-03T01:30:00.000+00:00" },
        ],
      },
    ],
  };

  const result = parseTimeline(timeline, {
    years: [2020],
    fillMissingDays: true,
    countryResolver: fakeCountryResolver,
  });

  assert.equal(result.history["2020-01-02"].country, "Country C");
  assert.equal(result.history["2020-01-03"].country, "Country C");
  assert.equal(result.history["2020-01-04"].country, "Country C");
  assert.equal(result.history["2020-01-04"].guess, true);
  assert.equal(result.summary.stats.daysMissing, 1);
});

test("preferred country wins when multiple points exist on same day", () => {
  const timeline = {
    semanticSegments: [
      {
        startTime: "2020-05-01T01:00:00.000+00:00",
        endTime: "2020-05-01T01:10:00.000+00:00",
        visit: {
          topCandidate: {
            placeLocation: {
              latLng: "20.0°, 20.0°",
            },
          },
        },
      },
      {
        startTime: "2020-05-01T03:00:00.000+00:00",
        endTime: "2020-05-01T03:10:00.000+00:00",
        visit: {
          topCandidate: {
            placeLocation: {
              latLng: "10.0°, 10.0°",
            },
          },
        },
      },
    ],
  };

  const result = parseTimeline(timeline, {
    years: [2020],
    preferredCountry: "Country B",
    fillMissingDays: false,
    countryResolver: fakeCountryResolver,
  });

  assert.equal(result.history["2020-05-01"].country, "Country B");
});

test("malformed data is counted instead of crashing", () => {
  const timeline = {
    semanticSegments: [
      {
        startTime: "2020-01-02T08:00:00.000+00:00",
        endTime: "2020-01-02T09:00:00.000+00:00",
        visit: {
          topCandidate: {
            placeLocation: {
              latLng: "not-a-point",
            },
          },
        },
      },
      {
        startTime: "2020-01-03T08:00:00.000+00:00",
        endTime: "2020-01-03T09:00:00.000+00:00",
        timelinePath: [{ foo: "bar" }],
      },
    ],
  };

  const result = parseTimeline(timeline, {
    years: [2020],
    fillMissingDays: false,
    countryResolver: fakeCountryResolver,
  });

  assert.equal(result.summary.stats.malformedSegments, 2);
  assert.equal(result.summary.stats.malformedPoints, 3);
});

