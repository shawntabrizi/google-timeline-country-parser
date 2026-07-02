"use strict";

const { dateKeysForYear, toDateKeyFromTimestamp, todayKeyLocal } = require("./dates");
const { parseCoordinate } = require("./latlng");

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function timestampToEpochMs(value) {
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : Number.NEGATIVE_INFINITY;
}

function initializeHistory(years) {
  const history = {};
  for (const year of years) {
    for (const day of dateKeysForYear(year)) {
      history[day] = null;
    }
  }
  return history;
}

function pickDateFromTimestamp(timestamp, fallbackDate) {
  const fromTimestamp = toDateKeyFromTimestamp(timestamp);
  if (fromTimestamp) {
    return fromTimestamp;
  }
  return fallbackDate || null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function splitIntoContiguousRuns(dayKeys) {
  const runs = [];
  let run = [];
  let prevEpoch = null;
  for (const day of dayKeys) {
    // Bare YYYY-MM-DD strings parse as UTC midnight, so consecutive calendar
    // days always differ by exactly one day regardless of local timezone/DST.
    const epoch = Date.parse(day);
    if (prevEpoch !== null && epoch - prevEpoch !== ONE_DAY_MS) {
      runs.push(run);
      run = [];
    }
    run.push(day);
    prevEpoch = epoch;
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

function addCountryCount(bucket, country) {
  if (bucket[country]) {
    bucket[country] += 1;
  } else {
    bucket[country] = 1;
  }
}

function sortCountryCounts(counts) {
  const entries = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  return Object.fromEntries(entries);
}

function buildSummary(history, years, parseStats, inferenceStats) {
  const countryCounts = {};
  const includeTotal = years.length > 1;

  for (const year of years) {
    countryCounts[String(year)] = {};
  }
  if (includeTotal) {
    countryCounts.total = {};
  }

  const stats = {
    ...parseStats,
    ...inferenceStats,
    daysTotal: 0,
    daysWithLocation: 0,
    daysMissing: 0,
    daysMissingFinal: 0,
    daysGuessed: 0,
  };

  for (const [day, record] of Object.entries(history)) {
    stats.daysTotal += 1;
    if (!record) {
      stats.daysMissing += 1;
      stats.daysMissingFinal += 1;
      continue;
    }

    stats.daysWithLocation += 1;
    if (record.guess) {
      stats.daysGuessed += 1;
    }

    const yearKey = day.slice(0, 4);
    addCountryCount(countryCounts[yearKey], record.country);
    if (includeTotal) {
      addCountryCount(countryCounts.total, record.country);
    }
  }

  for (const [yearKey, counts] of Object.entries(countryCounts)) {
    countryCounts[yearKey] = sortCountryCounts(counts);
  }

  return {
    years,
    countryCounts,
    stats,
  };
}

async function parseTimeline(timeline, options) {
  const years = Array.isArray(options.years) ? options.years : [];
  if (years.length === 0) {
    throw new Error("No years provided for parsing.");
  }

  const preferredCountry = options.preferredCountry || null;
  const preferredKey = normalizeName(preferredCountry);
  const fillMissingDays = options.fillMissingDays !== false;
  const maxInferGapDays =
    Number.isInteger(options.maxInferGapDays) && options.maxInferGapDays >= 0
      ? options.maxInferGapDays
      : 7;
  const countryResolver = options.countryResolver;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const yieldEvery =
    Number.isInteger(options.yieldEverySegments) && options.yieldEverySegments > 0
      ? options.yieldEverySegments
      : 1000;
  const yieldToEventLoop =
    typeof options.yieldToEventLoop === "function"
      ? options.yieldToEventLoop
      : async () =>
          new Promise((resolve) => {
            setImmediate(resolve);
          });

  if (typeof countryResolver !== "function") {
    throw new Error("A countryResolver function is required.");
  }
  if (maxInferGapDays < 0) {
    throw new Error("maxInferGapDays must be >= 0.");
  }

  if (!timeline || !Array.isArray(timeline.semanticSegments)) {
    throw new Error("Input JSON does not contain 'semanticSegments'.");
  }

  const history = initializeHistory(years);
  const yearsSet = new Set(years.map((year) => String(year)));
  const selectionMeta = new Map();

  const parseStats = {
    segmentsTotal: timeline.semanticSegments.length,
    segmentsWithSupportedShape: 0,
    segmentsInSelectedYears: 0,
    malformedSegments: 0,
    malformedPoints: 0,
  };

  function chooseExistingOrCandidate(dateKey, candidate, candidateEpoch) {
    const existing = history[dateKey];
    if (!existing) {
      history[dateKey] = candidate;
      selectionMeta.set(dateKey, {
        epoch: candidateEpoch,
        preferredHit: normalizeName(candidate.country) === preferredKey,
      });
      return;
    }

    const existingMeta = selectionMeta.get(dateKey) || {
      epoch: Number.NEGATIVE_INFINITY,
      preferredHit: normalizeName(existing.country) === preferredKey,
    };

    const candidatePreferredHit = normalizeName(candidate.country) === preferredKey;

    if (preferredKey) {
      if (candidatePreferredHit && !existingMeta.preferredHit) {
        history[dateKey] = candidate;
        selectionMeta.set(dateKey, {
          epoch: candidateEpoch,
          preferredHit: candidatePreferredHit,
        });
        return;
      }
      if (!candidatePreferredHit && existingMeta.preferredHit) {
        return;
      }
    }

    if (candidateEpoch >= existingMeta.epoch) {
      history[dateKey] = candidate;
      selectionMeta.set(dateKey, {
        epoch: candidateEpoch,
        preferredHit: candidatePreferredHit,
      });
    }
  }

  function addPoint(pointValue, timestamp, source, fallbackDate = null) {
    const dateKey = pickDateFromTimestamp(timestamp, fallbackDate);
    if (!dateKey || !yearsSet.has(dateKey.slice(0, 4))) {
      return "out_of_scope";
    }

    const parsed = parseCoordinate(pointValue);
    if (!parsed) {
      parseStats.malformedPoints += 1;
      return "malformed";
    }

    const resolved = countryResolver({
      lat: parsed.lat,
      lng: parsed.lng,
      preferredCountry,
    });

    const candidate = {
      date: dateKey,
      country: resolved.country || "Unknown",
      lat: parsed.lat,
      lng: parsed.lng,
      guess: false,
      source,
    };
    if (Array.isArray(resolved.codes) && resolved.codes.length > 0) {
      candidate.codes = resolved.codes;
    }

    chooseExistingOrCandidate(dateKey, candidate, timestampToEpochMs(timestamp || ""));
    return "accepted";
  }

  if (onProgress) {
    onProgress({ processedSegments: 0, totalSegments: timeline.semanticSegments.length });
  }

  for (let segmentIndex = 0; segmentIndex < timeline.semanticSegments.length; segmentIndex += 1) {
    const segment = timeline.semanticSegments[segmentIndex];
    let handledShape = false;
    let acceptedPoint = false;
    let malformedPointSeen = false;
    let pointCandidateSeen = false;
    let outOfScopePointSeen = false;
    const segmentDate = pickDateFromTimestamp(segment && segment.startTime, null);
    const inSelectedYears = segmentDate ? yearsSet.has(segmentDate.slice(0, 4)) : false;

    if (segment && segment.visit) {
      handledShape = true;
      pointCandidateSeen = true;
      const location = segment.visit.topCandidate && segment.visit.topCandidate.placeLocation;
      if (location && location.latLng) {
        const startStatus = addPoint(location.latLng, segment.startTime, "visit_start");
        const endStatus = addPoint(location.latLng, segment.endTime, "visit_end");
        acceptedPoint = acceptedPoint || startStatus === "accepted" || endStatus === "accepted";
        malformedPointSeen = malformedPointSeen || startStatus === "malformed" || endStatus === "malformed";
        outOfScopePointSeen =
          outOfScopePointSeen || startStatus === "out_of_scope" || endStatus === "out_of_scope";
      } else {
        parseStats.malformedPoints += 1;
        malformedPointSeen = true;
      }
    }

    if (segment && segment.activity) {
      handledShape = true;
      const start = segment.activity.start;
      const end = segment.activity.end;
      if (start) {
        pointCandidateSeen = true;
      }
      if (end) {
        pointCandidateSeen = true;
      }
      if (start && start.latLng) {
        const startStatus = addPoint(start.latLng, segment.startTime, "activity_start");
        acceptedPoint = acceptedPoint || startStatus === "accepted";
        malformedPointSeen = malformedPointSeen || startStatus === "malformed";
        outOfScopePointSeen = outOfScopePointSeen || startStatus === "out_of_scope";
      } else if (start) {
        parseStats.malformedPoints += 1;
        malformedPointSeen = true;
      }
      if (end && end.latLng) {
        const endStatus = addPoint(end.latLng, segment.endTime, "activity_end");
        acceptedPoint = acceptedPoint || endStatus === "accepted";
        malformedPointSeen = malformedPointSeen || endStatus === "malformed";
        outOfScopePointSeen = outOfScopePointSeen || endStatus === "out_of_scope";
      } else if (end) {
        parseStats.malformedPoints += 1;
        malformedPointSeen = true;
      }
    }

    if (segment && Array.isArray(segment.timelinePath)) {
      handledShape = true;
      if (segment.timelinePath.length > 0) {
        pointCandidateSeen = true;
      }
      for (const node of segment.timelinePath) {
        if (!node || !node.point) {
          parseStats.malformedPoints += 1;
          malformedPointSeen = true;
          continue;
        }
        const status = addPoint(node.point, node.time, "timeline_path", segmentDate);
        acceptedPoint = acceptedPoint || status === "accepted";
        malformedPointSeen = malformedPointSeen || status === "malformed";
        outOfScopePointSeen = outOfScopePointSeen || status === "out_of_scope";
      }
    }

    if (handledShape) {
      parseStats.segmentsWithSupportedShape += 1;
      if (inSelectedYears) {
        parseStats.segmentsInSelectedYears += 1;
      }
      if (!acceptedPoint && (malformedPointSeen || (inSelectedYears && pointCandidateSeen && !outOfScopePointSeen))) {
        parseStats.malformedSegments += 1;
      }
    }

    if (onProgress && segmentIndex > 0 && segmentIndex % yieldEvery === 0) {
      onProgress({
        processedSegments: segmentIndex,
        totalSegments: timeline.semanticSegments.length,
      });
      await yieldToEventLoop();
    }
  }

  if (onProgress) {
    onProgress({
      processedSegments: timeline.semanticSegments.length,
      totalSegments: timeline.semanticSegments.length,
    });
  }

  const today = todayKeyLocal();
  const dayKeys = Object.keys(history);

  for (const day of dayKeys) {
    if (day > today) {
      delete history[day];
      selectionMeta.delete(day);
    }
  }

  const boundedDayKeys = Object.keys(history);

  const inferenceStats = {
    daysMissingRaw: 0,
    daysInferred: 0,
    inferenceMode: fillMissingDays ? "bounded" : "none",
    maxInferGapDays,
  };

  for (const day of boundedDayKeys) {
    if (!history[day]) {
      inferenceStats.daysMissingRaw += 1;
    }
  }

  function inferFromTemplate(template, day, source, confidence) {
    history[day] = {
      ...template,
      date: day,
      guess: true,
      source,
      inferenceConfidence: confidence,
    };
    selectionMeta.set(day, {
      epoch: Number.NEGATIVE_INFINITY,
      preferredHit: normalizeName(history[day].country) === preferredKey,
    });
    inferenceStats.daysInferred += 1;
  }

  if (fillMissingDays) {
    // Non-contiguous requested years (e.g. "2020,2022") produce day keys with
    // calendar gaps between them. Inference must never treat days across such a
    // gap as adjacent, so fill each contiguous run of days independently.
    for (const runDayKeys of splitIntoContiguousRuns(boundedDayKeys)) {
      fillGapsInRun(runDayKeys);
    }
  }

  function fillGapsInRun(runDayKeys) {
    for (let index = 0; index < runDayKeys.length; index += 1) {
      const day = runDayKeys[index];
      if (history[day]) {
        continue;
      }

      const start = index;
      while (index < runDayKeys.length && !history[runDayKeys[index]]) {
        index += 1;
      }

      const end = index - 1;
      const gapSize = end - start + 1;
      const prev = start > 0 ? history[runDayKeys[start - 1]] : null;
      const next = index < runDayKeys.length ? history[runDayKeys[index]] : null;

      if (prev && next) {
        if (prev.country !== next.country) {
          continue;
        }
        for (let cursor = start; cursor <= end; cursor += 1) {
          const dayToFill = runDayKeys[cursor];
          const distanceFromStart = cursor - start;
          const distanceFromEnd = end - cursor;
          const basis = distanceFromStart <= distanceFromEnd ? prev : next;
          inferFromTemplate(basis, dayToFill, "interpolate_between", "high");
        }
        continue;
      }

      if (gapSize > maxInferGapDays) {
        continue;
      }

      if (prev && !next) {
        for (let cursor = start; cursor <= end; cursor += 1) {
          inferFromTemplate(prev, runDayKeys[cursor], "carry_forward", "medium");
        }
        continue;
      }

      if (!prev && next) {
        for (let cursor = start; cursor <= end; cursor += 1) {
          inferFromTemplate(next, runDayKeys[cursor], "carry_backward", "medium");
        }
      }
    }
  }

  const summary = buildSummary(history, years, parseStats, inferenceStats);

  return {
    history,
    summary,
  };
}

module.exports = {
  parseTimeline,
};
