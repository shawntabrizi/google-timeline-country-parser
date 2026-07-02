#!/usr/bin/env node
/**
 * timeline-presence — parse Google Timeline exports into per-day presence,
 * activity summaries, and configurable presence tests.
 *
 * Zero runtime dependencies by design (supply-chain surface kept minimal):
 * argument parsing via node:util, geo data vendored, everything offline.
 */

import { existsSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { extractObservations } from "./ingest/timeline.ts";
import { loadArchive, mergeIntoArchive } from "./ingest/archive.ts";
import { createResolver } from "./geo/resolver.ts";
import { buildPresenceModel, type PresenceModel } from "./presence/days.ts";
import { summarize } from "./report/summary.ts";
import { evaluateRule } from "./rules/engine.ts";
import { loadPresets, loadRule } from "./rules/presets.ts";
import { compareHistories, historyOf } from "./report/compare.ts";
import { renderDashboard } from "./report/html.ts";
import { parseYearsInput } from "./years.ts";
import type { Observation, RuleResult } from "./types.ts";

const EXPORT_HELP = `No timeline data found.

Export your data from your phone (it only exists there):
  Android: Settings > Location > Location services > Timeline > Export Timeline data
  iPhone:  Google Maps app > your avatar > Your Timeline > ... > Export

Then either:
  timeline-presence ingest <path-to-Timeline.json>     (recommended: builds a local archive)
or pass the file directly with --input <file>.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Failed to read '${path}': ${(error as Error).message}`);
  }
}

// --- Shared input handling ---

interface CommonOptions {
  input?: string;
  archive: string;
  years?: number[];
  fill: boolean;
  maxInferGap: number;
  json: boolean;
}

const COMMON_OPTION_SPEC = {
  input: { type: "string" as const, short: "i" },
  archive: { type: "string" as const, default: "./archive" },
  years: { type: "string" as const, short: "y" },
  "no-fill": { type: "boolean" as const, default: false },
  "max-infer-gap": { type: "string" as const, default: "7" },
  json: { type: "boolean" as const, default: false },
};

function parseCommon(values: Record<string, unknown>): CommonOptions {
  const maxInferGap = Number.parseInt(String(values["max-infer-gap"]), 10);
  if (Number.isNaN(maxInferGap) || maxInferGap < 0 || maxInferGap > 365) {
    fail("Invalid --max-infer-gap: use a number of days between 0 and 365.");
  }
  const options: CommonOptions = {
    archive: String(values.archive),
    fill: values["no-fill"] !== true,
    maxInferGap,
    json: values.json === true,
  };
  if (typeof values.input === "string") {
    options.input = values.input;
  }
  if (typeof values.years === "string") {
    options.years = parseYearsInput(values.years);
  }
  return options;
}

function loadObservations(options: CommonOptions): Observation[] {
  if (options.input) {
    if (!existsSync(options.input)) {
      fail(`Input file '${options.input}' does not exist.\n\n${EXPORT_HELP}`);
    }
    const { observations, stats } = extractObservations(readJson(options.input));
    console.error(
      `Parsed ${stats.observations} observations from ${stats.semanticSegments} segments` +
        (stats.malformedEntries > 0 ? ` (${stats.malformedEntries} malformed entries skipped)` : "")
    );
    return observations;
  }

  const observations = loadArchive(options.archive, options.years);
  if (observations.length === 0) {
    if (existsSync("Timeline.json")) {
      console.error("Using ./Timeline.json (no archive found). Tip: run 'ingest' to build one.");
      return loadObservations({ ...options, input: "Timeline.json" });
    }
    fail(EXPORT_HELP);
  }
  console.error(`Loaded ${observations.length} observations from archive '${options.archive}'`);
  return observations;
}

function buildModel(options: CommonOptions): PresenceModel {
  const observations = loadObservations(options);
  const build: Parameters<typeof buildPresenceModel>[2] = {
    fillMissingDays: options.fill,
    maxInferGapDays: options.maxInferGap,
  };
  if (options.years) {
    build.years = options.years;
  }
  return buildPresenceModel(observations, createResolver(), build);
}

// --- Commands ---

function commandIngest(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { archive: { type: "string", default: "./archive" } },
    allowPositionals: true,
  });
  if (positionals.length === 0) {
    fail(`Usage: timeline-presence ingest <Timeline.json | directory>...\n\n${EXPORT_HELP}`);
  }

  const files: string[] = [];
  for (const target of positionals) {
    if (!existsSync(target)) {
      fail(`'${target}' does not exist.`);
    }
    if (statSync(target).isDirectory()) {
      for (const entry of readdirSync(target)) {
        if (entry.endsWith(".json")) {
          files.push(join(target, entry));
        }
      }
    } else {
      files.push(target);
    }
  }
  if (files.length === 0) {
    fail("No .json files found to ingest.");
  }

  const archiveDir = String(values.archive);
  for (const file of files) {
    const { observations, stats } = extractObservations(readJson(file));
    const result = mergeIntoArchive(archiveDir, observations);
    console.log(
      `${file}: ${result.added} new, ${result.duplicates} duplicate, ${result.invalid} invalid ` +
        `(from ${stats.observations} observations)`
    );
  }
  console.log(`Archive: ${resolve(archiveDir)} — keep this private; it is your location history.`);
}

function formatCountryTable(
  countries: Record<string, { observed: number; inferred: number; total: number }>,
  limit = 12
): string {
  const rows = Object.entries(countries).slice(0, limit);
  if (rows.length === 0) {
    return "  (no data)";
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  const lines = rows.map(
    ([name, c]) =>
      `  ${name.padEnd(width)}  ${String(c.total).padStart(4)} days` +
      (c.inferred > 0 ? `  (${c.observed} observed + ${c.inferred} inferred)` : "")
  );
  const hidden = Object.keys(countries).length - rows.length;
  if (hidden > 0) {
    lines.push(`  ... and ${hidden} more`);
  }
  return lines.join("\n");
}

function commandSummarize(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: COMMON_OPTION_SPEC });
  const options = parseCommon(values);
  const model = buildModel(options);
  const summary = summarize(model.history, model.stats);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  for (const year of summary.years) {
    console.log(`\n${year.year} — ${year.daysObserved} observed, ${year.daysInferred} inferred, ${year.daysUnknown} unknown, ${year.travelDays} travel days`);
    console.log(formatCountryTable(year.countries));
  }
  console.log(
    `\nTotal: ${summary.totals.daysObserved} observed + ${summary.totals.daysInferred} inferred days, ` +
      `${summary.totals.daysUnknown} unknown, last observed day ${summary.totals.lastObservedDay ?? "n/a"}`
  );
}

function formatRuleResult(result: RuleResult): string {
  const lines: string[] = [];
  lines.push(`\n${result.rule.title}  [${result.rule.id}]`);
  const glyph = (ok: boolean) => (ok ? "PASS" : "FAIL");
  for (const period of result.periods) {
    const margin =
      period.comparison === "at-least"
        ? period.observedDays - period.threshold
        : period.threshold - period.totalDays;
    lines.push(
      `  ${period.period}: observed ${period.observedDays} / ${period.comparison} ${period.threshold} -> ${glyph(period.satisfiedObserved)}` +
        (period.inferredDays > 0
          ? ` | with inferred ${period.totalDays} -> ${glyph(period.satisfiedWithInferred)}`
          : "") +
        (period.unknownDays > 0 ? ` | ${period.unknownDays} days unknown` : "") +
        ` | margin ${margin >= 0 ? "+" : ""}${Math.round(margin * 100) / 100}`
    );
    if (period.detail) {
      lines.push(`      ${period.detail}`);
    }
  }
  if (result.rule.notes) {
    lines.push(`  Note: ${result.rule.notes}`);
  }
  lines.push(`  ${result.disclaimer}`);
  return lines.join("\n");
}

function commandCheck(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { ...COMMON_OPTION_SPEC, rule: { type: "string", short: "r", multiple: true } },
  });
  const ruleIds = (values.rule ?? []) as string[];
  if (ruleIds.length === 0) {
    fail("Usage: timeline-presence check --rule <preset-id | file.json> [--rule ...]\nRun 'timeline-presence rules' to list presets.");
  }
  const options = parseCommon(values);
  const model = buildModel(options);
  const results = ruleIds.map((id) => evaluateRule(model.history, loadRule(id)));

  if (options.json) {
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }
  for (const result of results) {
    console.log(formatRuleResult(result));
  }
}

function commandHistory(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { ...COMMON_OPTION_SPEC, out: { type: "string", short: "o" } },
  });
  const options = parseCommon(values);
  const model = buildModel(options);
  const payload = JSON.stringify({ history: model.history, stats: model.stats }, null, 2);
  if (typeof values.out === "string") {
    writeFileSync(values.out, payload);
    console.error(`Wrote day history to ${values.out} — contains location data, keep private.`);
  } else {
    console.log(payload);
  }
}

function commandReport(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      ...COMMON_OPTION_SPEC,
      out: { type: "string", short: "o", default: "report.html" },
      rule: { type: "string", short: "r", multiple: true },
    },
  });
  const options = parseCommon(values);
  const model = buildModel(options);
  const summary = summarize(model.history, model.stats);
  const ruleIds = (values.rule ?? ["act60-pr-183"]) as string[];
  const results = ruleIds.map((id) => evaluateRule(model.history, loadRule(id)));

  const html = renderDashboard(model.history, summary, results);
  const outPath = String(values.out);
  writeFileSync(outPath, html);
  console.log(`Report written to ${resolve(outPath)}`);
  console.log("It embeds your location history — treat it like the data itself.");
}

function commandRules(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean", default: false } },
  });
  const presets = loadPresets();
  if (values.json === true) {
    console.log(JSON.stringify(presets, null, 2));
    return;
  }
  for (const preset of presets) {
    console.log(`${preset.id.padEnd(26)} ${preset.title}`);
  }
  console.log("\nUse: timeline-presence check --rule <id>   (or --rule ./custom-rule.json)");
}

function commandCompare(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      "max-diffs": { type: "string", default: "40" },
    },
    allowPositionals: true,
  });
  if (positionals.length !== 2) {
    fail("Usage: timeline-presence compare <left.json> <right.json>");
  }
  const left = historyOf(readJson(positionals[0]!));
  const right = historyOf(readJson(positionals[1]!));
  const result = compareHistories(left, right);

  if (values.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Compared ${result.daysCompared} days:`);
  for (const [category, count] of Object.entries(result.counts)) {
    if (count > 0) {
      console.log(`  ${category.padEnd(28)} ${count}`);
    }
  }
  const limit = Number.parseInt(String(values["max-diffs"]), 10) || 40;
  const shown = result.diffs.slice(0, limit);
  if (shown.length > 0) {
    console.log(`\nFirst ${shown.length} differing days:`);
    for (const diff of shown) {
      console.log(`  ${diff.date}  ${diff.category}: ${diff.left} -> ${diff.right}`);
    }
    if (result.diffs.length > shown.length) {
      console.log(`  ... and ${result.diffs.length - shown.length} more (use --json for all)`);
    }
  }
}

// --- Dispatch ---

const HELP = `timeline-presence — location presence from Google Timeline exports (offline)

Commands:
  ingest <file|dir>...   Merge Timeline export(s) into the local archive
  summarize              Activity summary by year and country
  check --rule <id>      Evaluate presence test(s); see 'rules' for presets
  history [--out f]      Dump the per-day history (JSON)
  report [--out f]       Self-contained HTML dashboard
  rules                  List built-in presence-test presets
  compare <a> <b>        Day-by-day diff of two history outputs

Common options:
  -i, --input <file>     Read a Timeline.json directly (skip archive)
      --archive <dir>    Archive directory (default ./archive)
  -y, --years <spec>     e.g. '2024' or '2020-2023,2025' (default: all in data)
      --no-fill          Disable missing-day inference
      --max-infer-gap N  Max one-sided gap to fill (default 7 days)
      --json             Machine-readable output`;

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "ingest":
      return commandIngest(rest);
    case "summarize":
      return commandSummarize(rest);
    case "check":
      return commandCheck(rest);
    case "history":
      return commandHistory(rest);
    case "report":
      return commandReport(rest);
    case "rules":
      return commandRules(rest);
    case "compare":
      return commandCompare(rest);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      fail(`Unknown command '${command}'.\n\n${HELP}`);
  }
}

main();
