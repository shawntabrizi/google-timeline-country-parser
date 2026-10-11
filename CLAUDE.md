# CLAUDE.md

## What this project is

An offline CLI that parses Google Timeline exports into per-day country
presence and evaluates configurable presence tests. The original motivating
use case is Puerto Rico Act 60 compliance (≥183 PR days/year), but nothing is
hardcoded to it — rules are JSON presets in `presets/`.

## Domain rules that shape the code

- **Day counts can carry legal weight.** A day keeps ALL regions touched
  (never one winner); presence tests count a day if you were in the region any
  part of it. Confidence is explicit: observed / inferred / unknown, and rule
  output always separates observed from with-inferred.
- **Territories stay distinct from owners.** A PR coordinate resolves to
  `country: "Puerto Rico", codes: ["USA","PRI"]`. Rules match any code by
  default; `exact: true` matches only the most-specific code (the US
  Substantial Presence Test excludes territories). Never fold PR into US.
- **Inference is conservative and never crosses non-contiguous years** (this
  bug shipped once — see test/presence.test.ts regression guard).
- **Day keys are the local calendar date of the PLACE** (`src/geo/timezone.ts`).
  Exports render every timestamp in the phone's zone *at export time*, so the
  offset in the text is meaningless for day boundaries; only the instant is
  trusted. Each fix takes the IANA zone of its location (nearest zone.tab
  reference city within its country; longitude for open ocean). Not UTC:
  presence tests and evidence use local dates. `check`/`report` also run a
  UTC-boundary model and list dates that depend on the boundary.
- **Archive dedupe is by instant**, never by timestamp text (re-exports from
  another zone re-label every fix).

## Hard constraints

- **Privacy:** real location data must never be committed. `.gitignore` denies
  all `*.json` except an allowlist. Tests use synthetic fixtures with public
  landmark coordinates only. Never paste real coordinates into code, tests,
  commits, or PR text. Generated reports and archives live in gitignored paths.
- **Zero runtime dependencies** (supply-chain hardening): CLI arg parsing via
  `node:util` parseArgs; geo lookup is our own point-in-polygon over vendored
  `src/geo/data/borders.json` (from country-coder, ISC). The legacy geo
  packages exist only as devDependencies for `scripts/geo-shootout.ts`.
- **No build step:** Node ≥ 22.6 runs `.ts` directly (type stripping), so
  TypeScript must stay erasable-syntax-only (no enums, no parameter
  properties). `yarn typecheck` must stay clean.

## Verifying changes

- `yarn test` — synthetic-fixture suite; every preset has test vectors (a
  preset without vectors doesn't merge).
- Real-data regression: run `node src/cli.ts history -i Timeline.json -o
  local/new.json` and `node src/cli.ts compare local/<baseline>.json
  local/new.json`. Any `changed` days need an explanation before merging;
  keep baselines in `local/` (gitignored).
