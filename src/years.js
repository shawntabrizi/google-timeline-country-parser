"use strict";

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

function parseYearToken(token) {
  if (!/^\d{4}$/.test(token)) {
    throw new Error(`Invalid year '${token}'. Expected a 4-digit year.`);
  }
  const year = Number.parseInt(token, 10);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`Year '${token}' is out of supported range (${MIN_YEAR}-${MAX_YEAR}).`);
  }
  return year;
}

function parseYearsInput(yearsInput) {
  if (typeof yearsInput !== "string" || yearsInput.trim().length === 0) {
    throw new Error("The --years option must be a non-empty string.");
  }

  const years = new Set();
  const parts = yearsInput
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("No valid years were provided.");
  }

  for (const part of parts) {
    if (part.includes("-")) {
      const [startRaw, endRaw, ...rest] = part.split("-").map((x) => x.trim());
      if (rest.length > 0 || !startRaw || !endRaw) {
        throw new Error(`Invalid year range '${part}'. Use 'YYYY-YYYY'.`);
      }
      const start = parseYearToken(startRaw);
      const end = parseYearToken(endRaw);
      if (start > end) {
        throw new Error(`Invalid year range '${part}'. Start year must be <= end year.`);
      }
      for (let year = start; year <= end; year += 1) {
        years.add(year);
      }
    } else {
      years.add(parseYearToken(part));
    }
  }

  return Array.from(years).sort((a, b) => a - b);
}

module.exports = {
  parseYearsInput,
};

