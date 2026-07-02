"use strict";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todayKeyLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function toDateKeyFromTimestamp(timestamp) {
  if (typeof timestamp !== "string" || timestamp.length < 10) {
    return null;
  }
  const key = timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return null;
  }
  return key;
}

function dateKeysForYear(year) {
  const keys = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  while (cursor.getUTCFullYear() === year) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

module.exports = {
  dateKeysForYear,
  toDateKeyFromTimestamp,
  todayKeyLocal,
};

