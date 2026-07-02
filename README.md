# Google Timeline Country Parser

Turn your Google Maps Timeline export into a per-day record of **which countries
you were in**, activity summaries across years, and **presence-test checks**
(Puerto Rico Act 60, US Substantial Presence Test, UK SRT, Schengen 90/180, or
your own rule).

Runs entirely **offline** with **zero runtime dependencies** — your location
history never leaves your machine.

```
$ timeline-presence check --rule act60-pr-183

Puerto Rico Act 60 / IRS presence test — 183-day prong  [act60-pr-183]
  2024: observed 201 / at-least 183 -> PASS | with inferred 214 -> PASS | margin +18
  2025: observed 187 / at-least 183 -> PASS | margin +4
```

## Getting your data

Google stores Timeline data **only on your phone** (there is no API, and
Takeout no longer includes it). Export it:

- **Android:** Settings → Location → Location services → Timeline → **Export Timeline data**
- **iPhone:** Google Maps → your avatar → Your Timeline → ⋯ → **Export**

You get a single `Timeline.json`. Because the phone holds the only copy,
export regularly — the archive built by this tool doubles as your backup.

## Usage

Requires Node.js ≥ 22.6 (runs TypeScript natively — no build step).

```sh
# Merge an export into your local archive (repeatable; deduplicates)
node src/cli.ts ingest ~/Downloads/Timeline.json

# Where have I been?
node src/cli.ts summarize
node src/cli.ts summarize -y 2024 --json

# Check a presence test
node src/cli.ts rules                          # list built-in presets
node src/cli.ts check --rule act60-pr-183
node src/cli.ts check --rule ./my-rule.json    # or your own rule file

# Self-contained HTML dashboard (calendar heatmap + rule panels)
node src/cli.ts report --rule act60-pr-183 --rule schengen-90-180

# One-off runs without an archive
node src/cli.ts summarize --input Timeline.json
```

## How days are counted

Every day keeps **all** regions you touched (a San Juan → New York travel day
counts for both Puerto Rico and the US), and every day carries a confidence
status:

- **observed** — direct location observations that day (the defensible number)
- **inferred** — gap between observations, filled conservatively and labeled
  (same country on both sides: any gap, confidence graded high/medium/low by
  length; edges: at most `--max-infer-gap` days, default 7)
- **unknown** — no data, no safe inference; never counts toward any test

Rule checks always report *observed* and *with inferred* separately.
Coordinates resolve against vendored offline boundary data; territories stay
distinct from their owners on purpose — Puerto Rico days are not "US days"
(Act 60 needs them separate, and the Substantial Presence Test excludes them).

## Presence-test presets

| Preset | Test |
|---|---|
| `act60-pr-183` | Puerto Rico / IRS presence, 183 days per calendar year |
| `pr-presence-549-3yr` | Puerto Rico presence, 549 days over 3 years |
| `us-substantial-presence` | US SPT: current + ⅓ + ⅙ weighted years ≥ 183 |
| `uk-srt-183` | UK Statutory Residence: 183 midnights per UK tax year |
| `schengen-90-180` | Schengen short-stay: ≤ 90 days in any 180 |

Each preset states exactly what it simplifies and cites its source — read the
note it prints. **None of this is tax or legal advice.** Rules are plain JSON
validated on load; add your own or contribute one with test vectors.

## Privacy

- All processing is local; the tool makes no network requests of any kind.
- `.gitignore` denies all JSON by default; your exports, archive, and reports
  can't be committed by accident.
- The HTML report embeds your history — share it as deliberately as the data.

## Development

```sh
yarn test        # node:test suite (synthetic fixtures only)
yarn typecheck   # tsc --noEmit
node scripts/geo-shootout.ts Timeline.json   # compare geo backends on real data
```

Architecture and design rationale: [docs/REDESIGN.md](docs/REDESIGN.md).
Boundary data is vendored from [country-coder](https://github.com/rapideditor/country-coder)
(ISC) — see `src/geo/data/LICENSE`.
