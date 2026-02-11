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

function buildSummary(history, years, parseStats) {
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
    daysTotal: 0,
    daysWithLocation: 0,
    daysMissing: 0,
    daysGuessed: 0,
  };

  for (const [day, record] of Object.entries(history)) {
    stats.daysTotal += 1;
    if (!record) {
      stats.daysMissing += 1;
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

function parseTimeline(timeline, options) {
  const years = Array.isArray(options.years) ? options.years : [];
  if (years.length === 0) {
    throw new Error("No years provided for parsing.");
  }

  const preferredCountry = options.preferredCountry || null;
  const preferredKey = normalizeName(preferredCountry);
  const fillMissingDays = options.fillMissingDays !== false;
  const countryResolver = options.countryResolver;

  if (typeof countryResolver !== "function") {
    throw new Error("A countryResolver function is required.");
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

  for (const segment of timeline.semanticSegments) {
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
  }

  const today = todayKeyLocal();
  const dayKeys = Object.keys(history);
  let lastKnown = null;

  for (const day of dayKeys) {
    if (day > today) {
      delete history[day];
      selectionMeta.delete(day);
      continue;
    }

    if (!fillMissingDays) {
      if (history[day]) {
        lastKnown = history[day];
      }
      continue;
    }

    if (!history[day] && lastKnown) {
      history[day] = {
        ...lastKnown,
        date: day,
        guess: true,
        source: "carry_forward",
      };
      selectionMeta.set(day, {
        epoch: Number.NEGATIVE_INFINITY,
        preferredHit: normalizeName(history[day].country) === preferredKey,
      });
    } else if (history[day]) {
      lastKnown = history[day];
    }
  }

  const summary = buildSummary(history, years, parseStats);

  return {
    history,
    summary,
  };
}

module.exports = {
  parseTimeline,
};
