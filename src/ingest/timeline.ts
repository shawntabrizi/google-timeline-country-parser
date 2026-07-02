/**
 * Extracts location observations from a Google Timeline on-device export
 * (`Timeline.json`). Supports:
 *  - semanticSegments: visit, activity, timelinePath
 *  - rawSignals: position (raw GPS/WiFi fixes; recent history only)
 *
 * Timestamps are kept verbatim, including their UTC offset. Note: the offset
 * reflects the *device's* timezone at recording time, which almost always —
 * but not always — matches the location's timezone (e.g. a stale WiFi-based
 * position can carry the offset of wherever the device clock currently is).
 */

import { parseCoordinate } from "./coordinates.ts";
import type { Observation, ObservationSource } from "../types.ts";

export interface ExtractStats {
  semanticSegments: number;
  rawPositionSignals: number;
  observations: number;
  malformedEntries: number;
}

export interface ExtractResult {
  observations: Observation[];
  stats: ExtractStats;
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function extractObservations(exportJson: unknown): ExtractResult {
  const root = (exportJson ?? {}) as {
    semanticSegments?: unknown;
    rawSignals?: unknown;
  };
  const segments = Array.isArray(root.semanticSegments) ? root.semanticSegments : [];
  const rawSignals = Array.isArray(root.rawSignals) ? root.rawSignals : [];

  if (!Array.isArray(root.semanticSegments) && !Array.isArray(root.rawSignals)) {
    throw new Error(
      "Input does not look like a Timeline export: no 'semanticSegments' or 'rawSignals'."
    );
  }

  const observations: Observation[] = [];
  const stats: ExtractStats = {
    semanticSegments: segments.length,
    rawPositionSignals: 0,
    observations: 0,
    malformedEntries: 0,
  };

  function add(pointValue: unknown, time: unknown, source: ObservationSource): void {
    if (!isValidTimestamp(time)) {
      stats.malformedEntries += 1;
      return;
    }
    const coord = parseCoordinate(pointValue);
    if (!coord) {
      stats.malformedEntries += 1;
      return;
    }
    observations.push({ time, lat: coord.lat, lng: coord.lng, source });
  }

  for (const raw of segments) {
    const segment = raw as {
      startTime?: unknown;
      endTime?: unknown;
      visit?: { topCandidate?: { placeLocation?: { latLng?: unknown } } };
      activity?: { start?: { latLng?: unknown }; end?: { latLng?: unknown } };
      timelinePath?: unknown;
    };
    if (!segment || typeof segment !== "object") {
      stats.malformedEntries += 1;
      continue;
    }

    if (segment.visit) {
      const location = segment.visit.topCandidate?.placeLocation?.latLng;
      if (location === undefined) {
        stats.malformedEntries += 1;
      } else {
        // A visit is a stay at one place: it evidences presence at both the
        // start and end instants (which may fall on different days).
        add(location, segment.startTime, "visit_start");
        add(location, segment.endTime, "visit_end");
      }
    }

    if (segment.activity) {
      if (segment.activity.start !== undefined) {
        add(segment.activity.start?.latLng, segment.startTime, "activity_start");
      }
      if (segment.activity.end !== undefined) {
        add(segment.activity.end?.latLng, segment.endTime, "activity_end");
      }
    }

    if (Array.isArray(segment.timelinePath)) {
      for (const raw of segment.timelinePath) {
        const node = raw as { point?: unknown; time?: unknown } | null;
        // Older path nodes may omit per-node times; fall back to segment start.
        add(node?.point, node?.time ?? segment.startTime, "timeline_path");
      }
    }
  }

  for (const raw of rawSignals) {
    const signal = raw as {
      position?: { LatLng?: unknown; latLng?: unknown; timestamp?: unknown };
    };
    if (!signal?.position) {
      continue; // wifiScan / activityRecord signals carry no coordinates
    }
    stats.rawPositionSignals += 1;
    add(signal.position.LatLng ?? signal.position.latLng, signal.position.timestamp, "raw_position");
  }

  stats.observations = observations.length;
  return { observations, stats };
}
