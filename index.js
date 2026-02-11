#!/usr/bin/env node

const fs = require("fs");
const { Command } = require("commander");
const { createSpinner } = require("nanospinner");
const { createCountryResolver } = require("./src/country-resolver");
const { parseTimeline } = require("./src/timeline-parser");
const { parseYearsInput } = require("./src/years");

function main() {
  const program = new Command();
  program
    .requiredOption("-y, --years <years>", "Comma-separated years or ranges (e.g. '2014,2016-2018')")
    .option("-i, --input <file>", "Input file", "Timeline.json")
    .option("-o, --output <file>", "Output file", "output.json")
    .option("-p, --preferred-country <country>", "Preferred country for ambiguous coordinates")
    .option("--no-fill-missing", "Do not carry the previous known location to missing days")
    .option("--history-only", "Write only the date->record history object to output")
    .option("--pretty <spaces>", "JSON indentation spaces", "2")
    .option("-q, --quiet", "Reduce console output");

  program.parse(process.argv);
  const options = program.opts();

  const spinner = createSpinner("Loading timeline data...").start();
  let timeline;

  try {
    timeline = JSON.parse(fs.readFileSync(options.input, "utf8"));
  } catch (error) {
    spinner.error({ text: `Failed to read or parse '${options.input}': ${error.message}` });
    process.exit(1);
  }

  let years;
  try {
    years = parseYearsInput(options.years);
  } catch (error) {
    spinner.error({ text: error.message });
    process.exit(1);
  }

  spinner.update({ text: "Parsing timeline segments..." });

  let result;
  try {
    result = parseTimeline(timeline, {
      years,
      preferredCountry: options.preferredCountry || null,
      fillMissingDays: options.fillMissing,
      countryResolver: createCountryResolver(),
    });
  } catch (error) {
    spinner.error({ text: `Failed to parse timeline: ${error.message}` });
    process.exit(1);
  }

  spinner.update({ text: "Writing output..." });

  const indent = Number.parseInt(options.pretty, 10);
  if (Number.isNaN(indent) || indent < 0 || indent > 8) {
    spinner.error({ text: "Invalid --pretty value. Use a number between 0 and 8." });
    process.exit(1);
  }

  const outputPayload = options.historyOnly
    ? result.history
    : {
        history: result.history,
        summary: result.summary,
      };

  try {
    fs.writeFileSync(options.output, JSON.stringify(outputPayload, null, indent));
  } catch (error) {
    spinner.error({ text: `Failed to write '${options.output}': ${error.message}` });
    process.exit(1);
  }

  spinner.success({ text: `Processing complete. Wrote ${options.output}` });

  if (!options.quiet) {
    console.log(JSON.stringify(result.summary.countryCounts, null, 2));
    console.log(JSON.stringify(result.summary.stats, null, 2));
    if (result.summary.stats.malformedSegments > 0 || result.summary.stats.malformedPoints > 0) {
      console.warn(
        `Warnings: malformedSegments=${result.summary.stats.malformedSegments}, malformedPoints=${result.summary.stats.malformedPoints}`
      );
    }
  }
}

main();
