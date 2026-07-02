/**
 * Coordinate -> political region resolution, fully offline.
 *
 * Data: vendored `borders.json` from the country-coder project (ISC license,
 * see src/geo/data/LICENSE). Features are countries, territories, and
 * subterritories; a feature may name an owning `country` (e.g. Puerto Rico's
 * owner is the US). Geometries are disjoint at the most-specific level, so a
 * point matches exactly one feature, and we reconstruct the ownership chain
 * for the full code list.
 *
 * Resolution rule: the *most specific* region wins as the primary name —
 * a Puerto Rico coordinate resolves to country "Puerto Rico" with codes
 * ["USA", "PRI"] (least specific first). This matters: presence tests like
 * Act 60 need PR distinguished from the mainland US, and tests like the US
 * Substantial Presence Test exclude territories — so PR days must never be
 * silently folded into "United States".
 */

import { readFileSync } from "node:fs";
import { RegionIndex, type GeoFeature } from "./point-in-region.ts";
import type { RegionResolution } from "../types.ts";

interface BorderProperties {
  iso1A2?: string;
  iso1A3?: string;
  nameEn?: string;
  /** iso1A2 of the owning country, for territories. */
  country?: string;
  aliases?: string[];
}

export type Resolver = (lat: number, lng: number) => RegionResolution;

export const UNKNOWN_REGION: RegionResolution = { country: "Unknown", codes: [] };

/**
 * ISO pseudo-codes that partition a country rather than naming a distinct
 * territory (e.g. FXX = "Metropolitan France"). These roll up to their owner:
 * nobody counts "Metropolitan France days". Real territories with their own
 * ISO assignment (PRI, HKG, GLP, ...) stay distinct on purpose — presence
 * tests routinely need them separated from the owning country.
 */
const ROLL_UP_CODES = new Set(["FXX"]);

export function createResolver(bordersPath?: string): Resolver {
  const dataPath =
    bordersPath ?? new URL("./data/borders.json", import.meta.url).pathname;
  const collection = JSON.parse(readFileSync(dataPath, "utf8")) as {
    features: GeoFeature[];
  };

  const byIso2 = new Map<string, GeoFeature>();
  for (const feature of collection.features) {
    const props = feature.properties as unknown as BorderProperties;
    if (props.iso1A2) {
      byIso2.set(props.iso1A2, feature);
    }
  }

  const index = new RegionIndex(collection.features);
  const cache = new Map<string, RegionResolution>();

  return (lat: number, lng: number): RegionResolution => {
    // ~110m precision — ample for country attribution, keeps the cache tight.
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const matches = index.query(lat, lng);
    let result: RegionResolution;

    if (matches.length === 0) {
      result = UNKNOWN_REGION;
    } else {
      // If multiple features match (shouldn't happen with disjoint data),
      // prefer the one that is owned (more specific).
      const match =
        matches.find((f) => (f.properties as BorderProperties).country) ?? matches[0]!;
      const props = match.properties as unknown as BorderProperties;

      // Walk the ownership chain root-first so codes read least → most specific.
      const chain: BorderProperties[] = [props];
      let owner = props.country;
      while (owner) {
        const ownerFeature = byIso2.get(owner);
        if (!ownerFeature) {
          break;
        }
        const ownerProps = ownerFeature.properties as unknown as BorderProperties;
        chain.unshift(ownerProps);
        owner = ownerProps.country;
      }
      while (
        chain.length > 1 &&
        ROLL_UP_CODES.has(chain[chain.length - 1]!.iso1A3 ?? "")
      ) {
        chain.pop();
      }

      const codes: string[] = [];
      for (const link of chain) {
        if (link.iso1A3 && !ROLL_UP_CODES.has(link.iso1A3)) {
          codes.push(link.iso1A3);
        }
      }

      result = {
        country: chain[chain.length - 1]!.nameEn ?? "Unknown",
        codes,
      };
    }

    cache.set(key, result);
    return result;
  };
}
