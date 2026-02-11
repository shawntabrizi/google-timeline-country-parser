# Google Timeline Country Parser

Parse Google Maps Timeline export data into a daily country-level history.

This parser supports the current `Timeline.json` export format, including:
- `visit` segments
- `activity` segments
- `timelinePath` segments

It is designed to be robust against malformed segments and unknown points while still producing output.

## Input

Export timeline data from your phone (Google Maps Timeline export) and place `Timeline.json` in this project root, or pass a custom file path with `--input`.

## Usage

```sh
yarn start -- -y 2024
```

```sh
Usage: index [options]

Options:
  -y, --years <years>                Comma-separated years or ranges (e.g. '2014,2016-2018')
  -i, --input <file>                 Input file (default: "Timeline.json")
  -o, --output <file>                Output file (default: "output.json")
  -p, --preferred-country <country>  Preferred country for ambiguous coordinates
  --no-fill-missing                  Disable missing-day inference
  --max-infer-gap <days>             Maximum size for one-sided missing-day inference gaps (default: "7")
  --history-only                     Write only the date->record history object to output
  --pretty <spaces>                  JSON indentation spaces (default: "2")
  -q, --quiet                        Reduce console output
  -h, --help                         display help for command
```

## Years Format

- Single year: `2024`
- List: `2022,2024`
- Range: `2020-2024`
- Mixed: `2019,2021-2023,2025`

## Output

Default output contains:
- `history`: map of `YYYY-MM-DD -> daily record | null`
- `summary`: years requested, per-year country day counts, aggregate counts (when multiple years), parse stats, and inference stats

Record shape:

```json
{
  "date": "2024-03-14",
  "country": "United States",
  "lat": 34.224286,
  "lng": -119.152395,
  "guess": false,
  "source": "visit_end",
  "codes": ["USA", "PRI"]
}
```

`guess: true` means the day was inferred (not directly observed). Inference now uses conservative bounded rules:
- If a gap is between two known days in the same country, fill it (`source: "interpolate_between"`).
- If a gap is one-sided (only before the first known day or after the last), fill only when gap size is `<= --max-infer-gap`.
- If surrounding countries differ, leave the gap missing.

Useful summary fields:
- `daysMissingRaw`: missing days before inference.
- `daysMissingFinal` (also `daysMissing`): missing days after inference.
- `daysInferred` (also `daysGuessed`): days filled by inference.

## Quality Guarantees

- Validates year input and rejects malformed year expressions.
- Handles malformed timeline segments without crashing.
- Parses real coordinate strings from all supported segment shapes.
- Produces deterministic daily selection with optional preferred country tie-breaking.
- Uses bounded inference with explicit confidence/source markers instead of unbounded forward-fill.
- Includes tests for parsing, selection logic, and malformed input handling.
