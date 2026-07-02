/** Loads and validates rule configs (built-in presets and user files). */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PeriodConfig, RuleConfig } from "../types.ts";

const PRESETS_DIR = new URL("../../presets/", import.meta.url).pathname;

function fail(context: string, message: string): never {
  throw new Error(`Invalid rule ${context}: ${message}`);
}

function validatePeriod(context: string, period: unknown): PeriodConfig {
  if (!period || typeof period !== "object") {
    fail(context, "'period' must be an object");
  }
  const p = period as Record<string, unknown>;
  switch (p.type) {
    case "calendar-year":
      return { type: "calendar-year" };
    case "offset-year":
      if (typeof p.start !== "string" || !/^\d{2}-\d{2}$/.test(p.start)) {
        fail(context, "offset-year requires start 'MM-DD'");
      }
      return { type: "offset-year", start: p.start };
    case "rolling-window":
      if (typeof p.windowDays !== "number" || p.windowDays < 1) {
        fail(context, "rolling-window requires positive windowDays");
      }
      return { type: "rolling-window", windowDays: p.windowDays };
    case "multi-year-weighted": {
      if (
        !Array.isArray(p.weights) ||
        p.weights.length === 0 ||
        !p.weights.every((w) => typeof w === "number" && w >= 0)
      ) {
        fail(context, "multi-year-weighted requires a numeric weights array");
      }
      const result: PeriodConfig = {
        type: "multi-year-weighted",
        weights: p.weights as number[],
      };
      if (p.minCurrentYearDays !== undefined) {
        if (typeof p.minCurrentYearDays !== "number" || p.minCurrentYearDays < 0) {
          fail(context, "minCurrentYearDays must be a non-negative number");
        }
        result.minCurrentYearDays = p.minCurrentYearDays;
      }
      return result;
    }
    default:
      fail(context, `unknown period type '${String(p.type)}'`);
  }
}

export function validateRule(raw: unknown, context: string): RuleConfig {
  if (!raw || typeof raw !== "object") {
    fail(context, "not an object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) fail(context, "missing 'id'");
  if (typeof r.title !== "string") fail(context, "missing 'title'");
  if (!r.region || typeof r.region !== "object") fail(context, "missing 'region'");
  const region = r.region as Record<string, unknown>;
  if (
    typeof region.country !== "string" &&
    typeof region.code !== "string" &&
    !Array.isArray(region.codes)
  ) {
    fail(context, "'region' needs 'country', 'code', or 'codes'");
  }
  if (r.counting !== "any-presence" && r.counting !== "midnights") {
    fail(context, "'counting' must be 'any-presence' or 'midnights'");
  }
  if (typeof r.threshold !== "number" || r.threshold < 0) {
    fail(context, "'threshold' must be a non-negative number");
  }
  if (r.comparison !== "at-least" && r.comparison !== "at-most") {
    fail(context, "'comparison' must be 'at-least' or 'at-most'");
  }

  const rule: RuleConfig = {
    id: r.id,
    title: r.title,
    region: region as RuleConfig["region"],
    counting: r.counting,
    period: validatePeriod(context, r.period),
    threshold: r.threshold,
    comparison: r.comparison,
  };
  if (Array.isArray(r.references)) {
    rule.references = r.references.filter((x): x is string => typeof x === "string");
  }
  if (typeof r.notes === "string") {
    rule.notes = r.notes;
  }
  return rule;
}

export function loadPresets(dir: string = PRESETS_DIR): RuleConfig[] {
  const rules: RuleConfig[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const raw = JSON.parse(readFileSync(join(dir, entry), "utf8"));
    rules.push(validateRule(raw, `preset '${entry}'`));
  }
  return rules;
}

export function loadRule(idOrPath: string, presetsDir?: string): RuleConfig {
  if (idOrPath.endsWith(".json")) {
    const raw = JSON.parse(readFileSync(idOrPath, "utf8"));
    return validateRule(raw, `file '${idOrPath}'`);
  }
  const presets = loadPresets(presetsDir);
  const preset = presets.find((rule) => rule.id === idOrPath);
  if (!preset) {
    const available = presets.map((rule) => rule.id).join(", ");
    throw new Error(`Unknown rule '${idOrPath}'. Built-in presets: ${available}`);
  }
  return preset;
}
