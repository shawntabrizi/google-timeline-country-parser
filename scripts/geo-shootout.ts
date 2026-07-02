/**
 * Geo backend shootout: classifies every unique coordinate in a real Timeline
 * export with both the legacy geo stack (coordinate_to_country, 47MB maritime
 * boundaries + ~10 transitive deps) and the new vendored resolver
 * (src/geo/data/borders.json + own point-in-polygon), then reports where they
 * disagree so the difference can be inspected before switching.
 *
 * Usage: node scripts/geo-shootout.ts <Timeline.json> [--examples N]
 *
 * Privacy: prints only coordinates rounded to 2 decimals (~1 km) and only for
 * disagreements. Nothing is written to disk.
 *
 * Note: requires the legacy packages, which are intentionally NOT runtime
 * dependencies. Run `yarn add -D coordinate_to_country country-code-lookup`
 * first if they are absent.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extractObservations } from "../src/ingest/timeline.ts";
import { createResolver } from "../src/geo/resolver.ts";

const require = createRequire(import.meta.url);

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/geo-shootout.ts <Timeline.json>");
  process.exit(1);
}

const legacyLookup = require("coordinate_to_country") as (
  lat: number,
  lng: number
) => string[];
const isoLookup = require("country-code-lookup") as {
  byIso(code: string): { country: string } | null;
};

const exportJson = JSON.parse(readFileSync(inputPath, "utf8"));
const { observations, stats } = extractObservations(exportJson);
console.error(`observations: ${stats.observations} (from ${stats.semanticSegments} segments)`);

const unique = new Map<string, { lat: number; lng: number }>();
for (const o of observations) {
  const key = `${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;
  if (!unique.has(key)) {
    unique.set(key, { lat: o.lat, lng: o.lng });
  }
}
console.error(`unique coordinates (3dp): ${unique.size}`);

const resolve = createResolver();

let agree = 0;
let bothUnknown = 0;
const disagreements = new Map<string, { count: number; examples: string[] }>();

const startLegacy = performance.now();
const legacyResults = new Map<string, string>();
for (const [key, { lat, lng }] of unique) {
  const codes = legacyLookup(lat, lng);
  legacyResults.set(key, codes.length > 0 ? codes[codes.length - 1]! : "?");
}
const legacyMs = performance.now() - startLegacy;

const startNew = performance.now();
const newResults = new Map<string, string>();
for (const [key, { lat, lng }] of unique) {
  const resolution = resolve(lat, lng);
  newResults.set(
    key,
    resolution.codes.length > 0 ? resolution.codes[resolution.codes.length - 1]! : "?"
  );
}
const newMs = performance.now() - startNew;

for (const [key, { lat, lng }] of unique) {
  const legacy = legacyResults.get(key)!;
  const next = newResults.get(key)!;
  if (legacy === next) {
    if (legacy === "?") {
      bothUnknown += 1;
    } else {
      agree += 1;
    }
    continue;
  }
  const pair = `${legacy} -> ${next}`;
  const entry = disagreements.get(pair) ?? { count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 5) {
    entry.examples.push(`${lat.toFixed(2)},${lng.toFixed(2)}`);
  }
  disagreements.set(pair, entry);
}

const totalDisagree = [...disagreements.values()].reduce((n, d) => n + d.count, 0);
console.log(`agree: ${agree}  both-unknown: ${bothUnknown}  disagree: ${totalDisagree}`);
console.log(`legacy: ${Math.round(legacyMs)}ms  new: ${Math.round(newMs)}ms`);
console.log("");

const sorted = [...disagreements.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [pair, { count, examples }] of sorted) {
  const legacyName = pair.split(" -> ")[0];
  const iso = legacyName && legacyName !== "?" ? isoLookup.byIso(legacyName) : null;
  console.log(
    `${pair}  x${count}  ${iso ? `(legacy name: ${iso.country})` : ""}  examples(2dp): ${examples.join(" ")}`
  );
}
