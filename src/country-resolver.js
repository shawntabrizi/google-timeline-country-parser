"use strict";

const coordinateToCountry = require("coordinate_to_country");
const countryCodeLookup = require("country-code-lookup");

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createCountryResolver() {
  const cache = new Map();

  return ({ lat, lng, preferredCountry = null }) => {
    const preferredKey = normalizeName(preferredCountry);
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}|${preferredKey}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    let codes = [];
    try {
      const output = coordinateToCountry(lat, lng);
      if (Array.isArray(output)) {
        codes = output;
      }
    } catch (_error) {
      codes = [];
    }

    const countries = [];
    for (const code of codes) {
      const details = countryCodeLookup.byIso(String(code).toUpperCase());
      if (details && details.country) {
        countries.push(details.country);
      }
    }

    let country = "Unknown";
    if (countries.length > 0) {
      if (preferredKey) {
        const preferredHit = countries.find((name) => normalizeName(name) === preferredKey);
        if (preferredHit) {
          country = preferredHit;
        } else {
          country = countries[countries.length - 1];
        }
      } else {
        country = countries[countries.length - 1];
      }
    }

    const result = {
      country,
      codes,
    };
    cache.set(key, result);
    return result;
  };
}

module.exports = {
  createCountryResolver,
};

