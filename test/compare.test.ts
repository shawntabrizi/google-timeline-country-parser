import test from "node:test";
import assert from "node:assert/strict";
import { compareHistories, historyOf } from "../src/report/compare.ts";
import { PR, US, observedDay, unknownDay } from "./helpers.ts";

test("compares v1 (legacy) output against v2 histories by ISO code", () => {
  const v1 = {
    history: {
      "2024-01-01": { date: "2024-01-01", country: "Puerto Rico", guess: false, codes: ["USA", "PRI"] },
      "2024-01-02": { date: "2024-01-02", country: "United States", guess: false, codes: ["USA"] },
      "2024-01-03": { date: "2024-01-03", country: "Puerto Rico", guess: true, codes: ["USA", "PRI"] },
      "2024-01-04": null,
      "2024-01-05": { date: "2024-01-05", country: "Spain", guess: false, codes: ["ESP"] },
    },
  };
  const v2 = {
    history: {
      "2024-01-01": observedDay("2024-01-01", [PR()]),
      // travel day: v1 kept only US, v2 keeps PR too -> same_plus_travel
      "2024-01-02": observedDay("2024-01-02", [PR(), US()]),
      // v1 guessed PR; v2 has no data -> newly_missing_was_guessed
      "2024-01-03": unknownDay("2024-01-03"),
      // v1 empty; v2 observed -> newly_attributed
      "2024-01-04": observedDay("2024-01-04", [US()]),
      // real change: Spain -> US
      "2024-01-05": observedDay("2024-01-05", [US()]),
    },
  };

  const result = compareHistories(historyOf(v1), historyOf(v2));
  assert.equal(result.counts.same, 1);
  assert.equal(result.counts.same_plus_travel, 1);
  assert.equal(result.counts.newly_missing_was_guessed, 1);
  assert.equal(result.counts.newly_attributed, 1);
  assert.equal(result.counts.changed, 1);
  assert.equal(result.daysCompared, 5);
});

test("name aliases bridge dataset naming differences", () => {
  // v1 record without codes: name-only comparison must still match
  // "United States" to "United States of America".
  const v1 = { "2024-02-01": { country: "United States", guess: false } };
  const v2 = { "2024-02-01": observedDay("2024-02-01", [US()]) };
  const result = compareHistories(v1, v2);
  assert.equal(result.counts.same, 1);
});
