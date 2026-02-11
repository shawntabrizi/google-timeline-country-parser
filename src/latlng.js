"use strict";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLatLng(lat, lng) {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

function parseCoordinateString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) {
    return null;
  }

  const lat = Number.parseFloat(matches[0]);
  const lng = Number.parseFloat(matches[1]);
  return normalizeLatLng(lat, lng);
}

function parseCoordinateObject(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (isFiniteNumber(value.lat) && isFiniteNumber(value.lng)) {
    return normalizeLatLng(value.lat, value.lng);
  }

  if (isFiniteNumber(value.latitude) && isFiniteNumber(value.longitude)) {
    return normalizeLatLng(value.latitude, value.longitude);
  }

  if (isFiniteNumber(value.latE7) && isFiniteNumber(value.lngE7)) {
    return normalizeLatLng(value.latE7 / 1e7, value.lngE7 / 1e7);
  }

  if (isFiniteNumber(value.latitudeE7) && isFiniteNumber(value.longitudeE7)) {
    return normalizeLatLng(value.latitudeE7 / 1e7, value.longitudeE7 / 1e7);
  }

  return null;
}

function parseCoordinate(value) {
  return parseCoordinateString(value) || parseCoordinateObject(value);
}

module.exports = {
  parseCoordinate,
};

