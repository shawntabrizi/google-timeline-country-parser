"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseYearsInput } = require("../src/years");

test("parseYearsInput expands ranges, de-duplicates, and sorts", () => {
  const years = parseYearsInput("2021, 2020-2022,2020");
  assert.deepEqual(years, [2020, 2021, 2022]);
});

test("parseYearsInput rejects invalid ranges", () => {
  assert.throws(() => parseYearsInput("2022-2020"), /Start year must be <= end year/);
});

test("parseYearsInput rejects invalid tokens", () => {
  assert.throws(() => parseYearsInput("202x"), /Invalid year/);
});

