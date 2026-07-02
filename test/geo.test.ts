import test from "node:test";
import assert from "node:assert/strict";
import { createResolver } from "../src/geo/resolver.ts";
import { LANDMARKS } from "./helpers.ts";

const resolve = createResolver();

test("Puerto Rico resolves as its own region, owned by the US", () => {
  const result = resolve(LANDMARKS.sanJuanPR.lat, LANDMARKS.sanJuanPR.lng);
  // The single most important classification in this tool: PR must be
  // distinct from the mainland US (Act 60 needs PR days; SPT excludes them).
  assert.equal(result.country, "Puerto Rico");
  assert.deepEqual(result.codes, ["USA", "PRI"]);
});

test("US mainland resolves to the US only", () => {
  const result = resolve(LANDMARKS.nycUS.lat, LANDMARKS.nycUS.lng);
  assert.deepEqual(result.codes, ["USA"]);
});

test("Metropolitan France rolls up to France (FXX is a partition, not a place)", () => {
  const result = resolve(LANDMARKS.parisFR.lat, LANDMARKS.parisFR.lng);
  assert.equal(result.country, "France");
  assert.deepEqual(result.codes, ["FRA"]);
});

test("Hong Kong stays distinct from China (real territory, like PR)", () => {
  const result = resolve(LANDMARKS.hongKong.lat, LANDMARKS.hongKong.lng);
  assert.equal(result.country, "Hong Kong");
  assert.deepEqual(result.codes, ["CHN", "HKG"]);
});

test("open ocean resolves to Unknown, not a guess", () => {
  const result = resolve(LANDMARKS.pointNemo.lat, LANDMARKS.pointNemo.lng);
  assert.equal(result.country, "Unknown");
  assert.deepEqual(result.codes, []);
});
