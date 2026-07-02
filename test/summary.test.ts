import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/report/summary.ts";
import type { BuildStats } from "../src/presence/days.ts";
import { PR, US, historyOf, observedDay } from "./helpers.ts";

const stats: BuildStats = {
  observationsUsed: 0,
  observationsOutOfScope: 0,
  daysTotal: 3,
  daysObserved: 3,
  daysInferred: 0,
  daysUnknown: 0,
  yearsIncluded: [2024],
};

test("solo vs travel days keep the US row honest next to Puerto Rico", () => {
  // Two full PR days, then a PR->US travel day. Any-presence counts the
  // travel day for both countries, so without the solo split the US row
  // would read as a full US day even though most of it was spent in PR.
  const history = historyOf([
    observedDay("2024-01-01", [PR()]),
    observedDay("2024-01-02", [PR()]),
    observedDay("2024-01-03", [PR(), US()]),
  ]);
  const summary = summarize(history, stats);
  const year = summary.years[0]!;

  assert.equal(year.travelDays, 1);
  assert.deepEqual(year.countries["Puerto Rico"], {
    observed: 3,
    inferred: 0,
    total: 3,
    solo: 2,
  });
  // The US saw exactly one day, and it was shared with PR — zero solo days.
  assert.deepEqual(year.countries["United States of America"], {
    observed: 1,
    inferred: 0,
    total: 1,
    solo: 0,
  });
});
