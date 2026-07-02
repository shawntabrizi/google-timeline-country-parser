/**
 * Self-contained HTML dashboard. No external requests of any kind — the page
 * embeds the user's location history, so it must be shareable-by-choice only.
 *
 * Encoding: calendar heatmap where hue = country (categorical, fixed slot
 * order by total days, 9th+ folds into "Other"), opacity = confidence
 * (observed vs inferred), empty cell = unknown. Rule panels are stat tiles
 * with status color + text label (never color alone).
 */

import type { DayHistory, RuleResult } from "../types.ts";
import type { ActivitySummary } from "./summary.ts";

// Validated categorical palette (light/dark are selected steps, not flips).
const SERIES_LIGHT = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const SERIES_DARK = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];
const OTHER_LIGHT = "#898781";
const OTHER_DARK = "#898781";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface CompactDay {
  d: string; // date
  c: number; // country slot index (-1 unknown, 8 = Other)
  s: 0 | 1; // 0 observed, 1 inferred
  label: string; // tooltip text (countries + status)
}

export function renderDashboard(
  history: DayHistory,
  summary: ActivitySummary,
  ruleResults: RuleResult[]
): string {
  // Fixed categorical assignment: top countries by total days across all years.
  const countryOrder = Object.keys(summary.totals.countries).filter((c) => c !== "Unknown");
  const slots = countryOrder.slice(0, 8);
  const slotOf = new Map(slots.map((c, i) => [c, i]));

  const days: CompactDay[] = [];
  for (const record of Object.values(history)) {
    if (record.status === "unknown") {
      days.push({ d: record.date, c: -1, s: 0, label: "no data" });
      continue;
    }
    const names = record.regions.map((r) => r.country).filter((c) => c !== "Unknown");
    const primary = names[0] ?? "Unknown";
    const slot = slotOf.get(primary) ?? 8;
    const status = record.status === "inferred" ? 1 : 0;
    const suffix =
      record.status === "inferred"
        ? ` — inferred (${record.inference?.kind}, ${record.inference?.confidence})`
        : "";
    days.push({
      d: record.date,
      c: primary === "Unknown" ? -1 : slot,
      s: status,
      label: `${names.join(" + ") || "Unknown"}${suffix}`,
    });
  }

  const lastObserved = summary.totals.lastObservedDay;
  const staleDays = lastObserved
    ? Math.floor((Date.now() - Date.parse(`${lastObserved}T00:00:00Z`)) / 86400000)
    : null;

  const rulePanels = ruleResults
    .map((result) => {
      const recent = result.periods.slice(-3).reverse();
      const rows = recent
        .map((p) => {
          const ok = p.satisfiedObserved;
          const okInferred = p.satisfiedWithInferred;
          return `<div class="rule-period">
            <div class="rule-period-label">${escapeHtml(p.period)}</div>
            <div class="rule-num">${p.observedDays}<span class="rule-thresh">/${p.comparison === "at-least" ? "≥" : "≤"}${p.threshold}</span></div>
            <div class="badge ${ok ? "pass" : "fail"}">${ok ? "✓ PASS" : "✕ FAIL"} <span class="badge-sub">observed</span></div>
            ${p.inferredDays > 0 ? `<div class="badge ${okInferred ? "pass" : "fail"} ghost">${okInferred ? "✓" : "✕"} ${p.totalDays} <span class="badge-sub">with inferred</span></div>` : ""}
            ${p.unknownDays > 0 ? `<div class="caveat">${p.unknownDays} days unknown</div>` : ""}
          </div>`;
        })
        .join("");
      return `<section class="rule-card">
        <h3>${escapeHtml(result.rule.title)}</h3>
        <div class="rule-periods">${rows}</div>
        ${result.rule.notes ? `<p class="notes">${escapeHtml(result.rule.notes)}</p>` : ""}
      </section>`;
    })
    .join("");

  const yearTables = summary.years
    .slice()
    .reverse()
    .map((year) => {
      const rows = Object.entries(year.countries)
        .map(([name, c]) => {
          const slot = slotOf.get(name);
          const swatch =
            name === "Unknown"
              ? ""
              : `<span class="swatch" data-slot="${slot ?? 8}"></span>`;
          return `<tr><td>${swatch}${escapeHtml(name)}</td><td class="num">${c.total}</td><td class="num">${c.observed}</td><td class="num">${c.inferred}</td></tr>`;
        })
        .join("");
      return `<details class="year-table"><summary>${year.year}: ${year.daysObserved} observed, ${year.daysInferred} inferred, ${year.daysUnknown} unknown, ${year.travelDays} travel days</summary>
        <table><thead><tr><th>Country</th><th class="num">Days</th><th class="num">Observed</th><th class="num">Inferred</th></tr></thead><tbody>${rows}</tbody></table></details>`;
    })
    .join("");

  const legend = slots
    .map((c, i) => `<span class="legend-item"><span class="swatch" data-slot="${i}"></span>${escapeHtml(c)}</span>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Timeline Presence Report</title>
<style>
  :root {
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
    --good: #0ca30c; --critical: #d03b3b;
    --s0: ${SERIES_LIGHT[0]}; --s1: ${SERIES_LIGHT[1]}; --s2: ${SERIES_LIGHT[2]}; --s3: ${SERIES_LIGHT[3]};
    --s4: ${SERIES_LIGHT[4]}; --s5: ${SERIES_LIGHT[5]}; --s6: ${SERIES_LIGHT[6]}; --s7: ${SERIES_LIGHT[7]};
    --s8: ${OTHER_LIGHT};
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-1: #1a1a19; --page: #0d0d0d;
      --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
      --good: #0ca30c; --critical: #d03b3b;
      --s0: ${SERIES_DARK[0]}; --s1: ${SERIES_DARK[1]}; --s2: ${SERIES_DARK[2]}; --s3: ${SERIES_DARK[3]};
      --s4: ${SERIES_DARK[4]}; --s5: ${SERIES_DARK[5]}; --s6: ${SERIES_DARK[6]}; --s7: ${SERIES_DARK[7]};
      --s8: ${OTHER_DARK};
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--page); color: var(--ink);
         font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: var(--ink-2); }
  h3 { font-size: 14px; margin: 0 0 8px; }
  .sub { color: var(--ink-2); margin: 0 0 16px; }
  .stale { color: var(--muted); }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; }
  .rule-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
               padding: 14px 16px; flex: 1 1 320px; max-width: 480px; }
  .rule-periods { display: flex; flex-wrap: wrap; gap: 16px; }
  .rule-period-label { color: var(--muted); font-size: 12px; }
  .rule-num { font-size: 26px; font-weight: 600; }
  .rule-thresh { font-size: 13px; color: var(--muted); font-weight: 400; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; margin-top: 2px; }
  .badge.pass { color: var(--good); } .badge.fail { color: var(--critical); }
  .badge.ghost { opacity: 0.75; font-weight: 400; display: block; }
  .badge-sub { color: var(--muted); font-weight: 400; }
  .caveat { font-size: 12px; color: var(--muted); }
  .notes { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
  .legend { margin: 8px 0 12px; display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 12px; color: var(--ink-2); }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  .legend-item .swatch { margin-right: 0; }
  ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `.swatch[data-slot="${i}"], .cell[data-slot="${i}"] { background: var(--s${i}); }`).join("\n  ")}
  .year { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
          padding: 12px 14px; margin-bottom: 10px; overflow-x: auto; }
  .year h3 { margin-bottom: 8px; }
  .cal { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); gap: 2px; width: max-content; }
  .cell { width: 11px; height: 11px; border-radius: 3px; background: transparent;
          box-shadow: inset 0 0 0 1px var(--grid); }
  .cell[data-slot] { box-shadow: none; }
  .cell.inferred { opacity: 0.45; }
  .year-table { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px;
                padding: 10px 14px; margin-bottom: 8px; }
  .year-table summary { cursor: pointer; color: var(--ink-2); }
  table { border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 3px 14px 3px 0; border-bottom: 1px solid var(--grid); font-size: 13px; }
  th { color: var(--muted); font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  #tip { position: fixed; pointer-events: none; background: var(--ink); color: var(--page);
         padding: 4px 8px; border-radius: 6px; font-size: 12px; display: none; z-index: 10; white-space: nowrap; }
  .disclaimer { color: var(--muted); font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<h1>Timeline Presence Report</h1>
<p class="sub">Last observed day: <strong>${lastObserved ?? "n/a"}</strong>${
    staleDays !== null && staleDays > 30
      ? ` <span class="stale">— ${staleDays} days ago. Consider exporting fresh Timeline data from your phone.</span>`
      : staleDays !== null
        ? ` <span class="stale">(${staleDays} days ago)</span>`
        : ""
  }</p>

<h2>Presence tests</h2>
<div class="cards">${rulePanels}</div>

<h2>Calendar</h2>
<div class="legend">${legend}<span class="legend-item"><span class="swatch" data-slot="8"></span>Other</span><span class="legend-item"><span class="swatch" style="opacity:.45;background:var(--s0)"></span>inferred (lighter)</span><span class="legend-item"><span class="swatch" style="box-shadow: inset 0 0 0 1px var(--grid)"></span>no data</span></div>
<div id="years"></div>

<h2>By year</h2>
${yearTables}

<p class="disclaimer">Generated offline by timeline-presence. This file embeds your location history — share deliberately. Not tax or legal advice; presence tests are modeled in simplified form (see each rule's note).</p>
<div id="tip" role="tooltip"></div>

<script>
const DAYS = ${JSON.stringify(days)};
const byYear = new Map();
for (const day of DAYS) {
  const year = day.d.slice(0, 4);
  if (!byYear.has(year)) byYear.set(year, []);
  byYear.get(year).push(day);
}
const container = document.getElementById("years");
const years = [...byYear.keys()].sort().reverse();
for (const year of years) {
  const section = document.createElement("div");
  section.className = "year";
  const h = document.createElement("h3");
  h.textContent = year;
  section.appendChild(h);
  const cal = document.createElement("div");
  cal.className = "cal";
  const jan1 = new Date(Date.UTC(+year, 0, 1));
  // leading blanks so rows align to weekday (Sunday first)
  for (let i = 0; i < jan1.getUTCDay(); i++) {
    const pad = document.createElement("span");
    pad.style.visibility = "hidden";
    pad.className = "cell";
    cal.appendChild(pad);
  }
  for (const day of byYear.get(year)) {
    const cell = document.createElement("span");
    cell.className = "cell" + (day.s === 1 ? " inferred" : "");
    if (day.c >= 0) cell.dataset.slot = String(day.c);
    cell.dataset.date = day.d;
    cell.dataset.label = day.label;
    cal.appendChild(cell);
  }
  section.appendChild(cal);
  container.appendChild(section);
}
const tip = document.getElementById("tip");
document.addEventListener("mouseover", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || !cell.dataset.date) { tip.style.display = "none"; return; }
  tip.textContent = cell.dataset.date + ": " + cell.dataset.label;
  tip.style.display = "block";
});
document.addEventListener("mousemove", (event) => {
  if (tip.style.display === "block") {
    tip.style.left = Math.min(event.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = (event.clientY + 14) + "px";
  }
});
</script>
</body>
</html>`;
}
