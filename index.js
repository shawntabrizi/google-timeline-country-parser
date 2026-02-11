#!/usr/bin/env node

const fs = require("fs");
const { Command } = require("commander");
const { createSpinner } = require("nanospinner");
const { createCountryResolver } = require("./src/country-resolver");
const { parseTimeline } = require("./src/timeline-parser");
const { parseYearsInput } = require("./src/years");

function createProgressReporter() {
  const supportsSpinner = Boolean(process.stdout.isTTY && process.stderr.isTTY);
  if (supportsSpinner) {
    return {
      mode: "spinner",
      instance: createSpinner("Loading timeline data...").start(),
      lastPercent: -1,
      start(text) {
        this.instance.update({ text });
      },
      update(text) {
        this.instance.update({ text });
      },
      tick(processed, total) {
        if (!total) {
          return;
        }
        const percent = Math.floor((processed / total) * 100);
        if (percent !== this.lastPercent && percent % 5 === 0) {
          this.lastPercent = percent;
          this.instance.update({ text: `Parsing timeline segments... ${percent}%` });
        }
      },
      success(text) {
        this.instance.success({ text });
      },
      error(text) {
        this.instance.error({ text });
      },
    };
  }

  return {
    mode: "plain",
    lastPercent: -1,
    start(text) {
      console.error(text);
    },
    update(text) {
      console.error(text);
    },
    tick(processed, total) {
      if (!total) {
        return;
      }
      const percent = Math.floor((processed / total) * 100);
      if (percent !== this.lastPercent && percent % 10 === 0) {
        this.lastPercent = percent;
        console.error(`Parsing timeline segments... ${percent}%`);
      }
    },
    success(text) {
      console.error(text);
    },
    error(text) {
      console.error(text);
    },
  };
}

async function main() {
  const program = new Command();
  program
    .requiredOption("-y, --years <years>", "Comma-separated years or ranges (e.g. '2014,2016-2018')")
    .option("-i, --input <file>", "Input file", "Timeline.json")
    .option("-o, --output <file>", "Output file", "output.json")
    .option("-p, --preferred-country <country>", "Preferred country for ambiguous coordinates")
    .option("--no-fill-missing", "Disable missing-day inference")
    .option("--max-infer-gap <days>", "Maximum size for one-sided missing-day inference gaps", "7")
    .option("--history-only", "Write only the date->record history object to output")
    .option("--pretty <spaces>", "JSON indentation spaces", "2")
    .option("-q, --quiet", "Reduce console output");

  program.parse(process.argv);
  const options = program.opts();

  const progress = createProgressReporter();
  progress.start("Loading timeline data...");
  let timeline;

  try {
    timeline = JSON.parse(fs.readFileSync(options.input, "utf8"));
  } catch (error) {
    progress.error(`Failed to read or parse '${options.input}': ${error.message}`);
    process.exit(1);
  }

  let years;
  try {
    years = parseYearsInput(options.years);
  } catch (error) {
    progress.error(error.message);
    process.exit(1);
  }

  progress.update("Parsing timeline segments...");

  const maxInferGapDays = Number.parseInt(options.maxInferGap, 10);
  if (Number.isNaN(maxInferGapDays) || maxInferGapDays < 0 || maxInferGapDays > 365) {
    progress.error("Invalid --max-infer-gap value. Use a number between 0 and 365.");
    process.exit(1);
  }

  let result;
  try {
    result = await parseTimeline(timeline, {
      years,
      preferredCountry: options.preferredCountry || null,
      fillMissingDays: options.fillMissing,
      maxInferGapDays,
      countryResolver: createCountryResolver(),
      onProgress: ({ processedSegments, totalSegments }) => progress.tick(processedSegments, totalSegments),
      yieldEverySegments: 1000,
    });
  } catch (error) {
    progress.error(`Failed to parse timeline: ${error.message}`);
    process.exit(1);
  }

  progress.update("Writing output...");

  const indent = Number.parseInt(options.pretty, 10);
  if (Number.isNaN(indent) || indent < 0 || indent > 8) {
    progress.error("Invalid --pretty value. Use a number between 0 and 8.");
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
    progress.error(`Failed to write '${options.output}': ${error.message}`);
    process.exit(1);
  }

  progress.success(`Processing complete. Wrote ${options.output}`);

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

main().catch((error) => {
  console.error(`Unexpected failure: ${error.message}`);
  process.exit(1);
});
