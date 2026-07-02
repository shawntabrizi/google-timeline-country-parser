# Redesign Plan

A ground-up redesign of this project: from a single-purpose Google Timeline country
parser into a general-purpose **location presence tracker** — parse location history,
summarize where you've been, and evaluate configurable presence tests (residency day
counts) against your real movements.

## Motivation

The original app was built for one job: counting days per country, specifically to
track Puerto Rico Act 60 compliance (183 days/year presence in PR). It works, but:

- Day attribution keeps only **one location per day** (latest wins), which
  structurally miscounts travel days. For most presence tests, a day counts if you
  were in the region **any part of that day** — a 7am flight out of PR should still
  count as a PR day.
- The PR/USA coordinate ambiguity (`["USA", "PRI"]`) is handled as a tie-break hack
  rather than a first-class concern.
- No region granularity below country level (US states, provinces).
- No durable data strategy: Google moved Timeline data on-device (no API, no Takeout);
  the phone holds the *only* copy of your history.
- Not built for extension, testing, or AI-agent collaboration.

## Product definition

**What it is:** an offline CLI + HTML-report tool that ingests location history
exports, maintains a durable local archive, and answers two questions:

1. **Where have I been?** — activity summaries: days per country/region per year,
   trips, travel days, most-visited places.
2. **Do I satisfy a presence test?** — configurable day-counting rules (jurisdiction
   residency tests), with built-in presets and an evidence trail.

**What it is not:** a cloud service, a real-time tracker, or a tax advisor. All
processing is local and offline — location history never leaves the machine.

### Priority-0 use case

Act 60 (Puerto Rico) presence test: ≥183 qualifying PR days per calendar year, with
per-day evidence good enough to hand to an accountant. This drives correctness
requirements but is **not hardcoded** — it ships as one preset among several.

## Architecture

TypeScript / Node. Layered pipeline; each layer is a small module with typed inputs
and outputs, independently testable.

```
src/
  ingest/     Parse Timeline.json exports (visit / activity / timelinePath),
              merge multiple exports into a canonical archive, dedupe.
  geo/        Offline reverse geocoding: coordinate -> country + admin-1 region.
  presence/   Observations -> per-day presence: timestamped region intervals,
              first/last seen, regions touched, region at midnight.
  rules/      Generic presence-test engine evaluating declarative rule configs.
  report/     Terminal summary, JSON/CSV artifacts, self-contained HTML dashboard.
  cli.ts      Command-line interface.
presets/      Built-in, tested presence-test definitions (see below).
```

### Ingest & the canonical archive

- Every export is parsed into **observations**: `(timestamp+offset, lat, lng, source)`.
- Observations merge into a local append-only archive (JSONL per year), deduped and
  idempotent — re-ingesting an overlapping export is a no-op.
- Raw exports are archived untouched alongside.
- Rationale: Timeline data lives only on the phone. Regular exports are the backup;
  the merged archive is the long-term source of truth and survives device loss.

### Geo layer

- Offline point-in-polygon lookup returning `{ country, admin1, codes }`.
- Candidate libraries: current `coordinate_to_country` vs `which-polygon` +
  Natural Earth admin-0/admin-1 data. Admin-1 support (US states, provinces) is
  strongly preferred — it enables region-level rules ("California days").
- Decision made **empirically**: classify every unique coordinate in the real
  ~60 MB Timeline export with both, diff the classifications, inspect
  disagreements — especially the Puerto Rico coastline.
- Ambiguous results (PR/USA style) are preserved as multi-region observations, not
  collapsed early.

### Presence layer

Per-day records retain enough structure for any rule semantics:

- regions touched (any-presence),
- region at local midnight (midnight-counting tests),
- first/last observation per region,
- observation counts and sources (evidence density).

Day boundaries use the local UTC offset embedded in each Google timestamp (the
local day where you physically were). Validated against real travel days before
being trusted.

**Confidence tiers** — every day is one of:

- `observed` — direct observations that day,
- `inferred` — bounded gap-fill between observations (flagged, conservative),
- `unknown` — no data, no safe inference.

Rule reports always show all three; compliance decisions should rest on `observed`.
Inference is a gap detector ("export more often"), not evidence.

## Rules engine & preset library

A presence test is **data, not code**:

```jsonc
{
  "id": "act60-pr",
  "title": "Puerto Rico Act 60 / IRS presence test (183-day prong)",
  "region": { "country": "Puerto Rico" },
  "counting": "any-presence",            // any-presence | midnights
  "period": { "type": "calendar-year" }, // calendar-year | rolling-window | multi-year-weighted
  "threshold": 183,
  "references": ["IRS Publication 570"],
  "notes": "Simplified: models the 183-day presence prong only."
}
```

The engine implements a small set of counting semantics and period shapes; rules
compose them. Target semantics at launch: `any-presence`, `midnights`; period shapes:
`calendar-year`, `rolling-window`, `multi-year-weighted`.

### Built-in presets

Most users have a standard use case — it should work out of the box:

| Preset | Test | Semantics |
|---|---|---|
| `act60-pr` | PR Act 60 / IRS presence, 183-day prong | any-presence, calendar year, ≥183 |
| `us-substantial-presence` | US SPT | weighted 3-year (1 + 1/3 + 1/6) ≥183, ≥31 current year |
| `uk-srt-183` | UK SRT automatic residence | midnights, tax year (Apr 6), ≥183 |
| `schengen-90-180` | Schengen short-stay limit | any-presence, rolling 180-day window, ≤90 |
| `us-state-183` | US state statutory residency (NY/CA-style) | any-presence, admin-1 region, calendar year, ≥183 |

Preset requirements:

- **Test vectors ship with every preset** — synthetic day-histories with expected
  outcomes, run in CI. These rules have legal weight; presets without tests don't merge.
- **Honest simplification notes** — real tests have prongs we don't model (SPT exempt
  days, UK SRT ties, travel-day exceptions). Each preset states exactly what it does
  and doesn't cover, and cites the official source.
- **Not tax advice** disclaimer in every rule report.
- **JSON Schema** for rule files, so users and contributors can add presets or write
  custom rules (`--rule ./my-rule.json`) with validation.
- Discovery: `rules list` shows presets; the dashboard can suggest relevant presets
  from the data ("you spent 140+ days in the UK — see uk-srt-183").

## CLI

```
parser ingest <export...>      merge exports into the local archive
parser summarize [--years ...] activity summary (no rule config needed)
parser check --rule <id|file>  evaluate presence test(s), all confidence tiers
parser report [--open]         self-contained HTML dashboard
parser rules list              show built-in presets
parser compare <a> <b>         day-by-day diff of two run outputs (regression tool)
```

Ergonomics: years default to "all years present in the data"; friendly errors (a
missing export explains the on-device export steps); machine-readable JSON output for
everything (`--json`), making the tool scriptable and AI-agent-friendly.

## HTML dashboard

Self-contained single file (no external requests — the data is sensitive):

- Calendar heatmap colored by country/region; per-year summaries.
- One panel per configured rule: running tally vs threshold, projection, flagged
  inferred/unknown days.
- Data-freshness nag: days since last export, unverifiable span of the current period.

## Data access strategy

Facts (as of 2026): Timeline is on-device only; no API; Takeout no longer includes it;
Google's cloud backup is encrypted and unreadable to us.

- **Now:** minimize export friction — export from the phone into a synced folder
  (Drive/Syncthing); `parser ingest` picks up whatever is there. Monthly cadence,
  nagged by the dashboard. Keep Google's encrypted backup enabled as device-loss
  insurance.
- **Later (optional):** adapters for continuous self-hosted loggers (OwnTracks,
  GPSLogger/GPX, Dawarich) as an independent second evidence source. Two independent
  sources agreeing on presence is stronger compliance evidence than one.

## Migration & testing strategy

Every algorithm/library change is validated against real data:

1. **Golden baseline first** (Phase 0, before any rewrite): run current `master`
   against the real `Timeline.json`; pin the output.
2. **`compare` tool**: day-by-day diff of any two outputs, every changed day
   categorized (different region / newly attributed / newly lost) with a reason.
3. Every subsequent change ships with a diff report vs baseline. Expected diffs
   (e.g., travel days now counting for PR under any-presence) are explained;
   unexpected diffs block the change.
4. **Geo library shootout** decided by diffing classifications of all unique real
   coordinates.
5. Unit tests: synthetic fixtures for ingest/presence; per-preset test vectors for
   rules. Real data is never committed (already gitignored).

## Engineering quality bar

- TypeScript, typed schemas for every artifact (rule files, archive records, outputs).
- `node --test` or vitest in CI (GitHub Actions); `engines: node >= 18`; `bin` entry
  for `npx` usage.
- Small modules, documented domain rules in `CLAUDE.md`, deterministic outputs —
  built to be worked on by humans and AI agents alike.
- Streaming/chunked parsing if exports outgrow comfortable `JSON.parse` (60 MB is fine).

## Phases

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 | Golden baseline + `compare` diff harness | Baseline pinned from real data; diffs categorize days |
| 1 | TS core: ingest + archive, geo layer (shootout), presence model | Real-data run matches baseline except explained diffs |
| 2 | Rules engine + preset library + `summarize`/`check` | Act 60 preset validated on real data; preset test vectors green |
| 3 | HTML dashboard | Heatmap + rule panels from real data |
| 4 | Pipeline ergonomics: synced-folder ingest; logger adapters (optional) | Monthly ritual ≤ 1 minute of human effort |

Each phase ends with a real-data run and a reviewed diff. Mistakes surface
immediately, not at tax time.
