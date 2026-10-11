import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localDayKey, longitudeZone, parseZoneTab, zoneForPoint } from "../src/geo/timezone.ts";

const at = (iso: string) => Date.parse(iso);

test("Puerto Rico evenings stay on the local date (UTC would move them)", () => {
  // 21:00 in San Juan is 01:00 UTC the next day. Presence tests count the
  // local calendar day, so this is the 25th, not the 26th.
  assert.equal(localDayKey(at("2010-11-09T01:00:00Z"), "America/Puerto_Rico"), "2010-11-08");
});

test("one instant gives one day however the export labeled it", () => {
  const zone = "America/Puerto_Rico";
  const labels = [
    "2010-11-08T21:00:00.000-04:00",
    "2010-11-09T08:00:00.000+07:00", // exported from a +07:00 zone
    "2010-11-09T01:00:00.000+00:00", // exported from a UTC zone
  ];
  for (const label of labels) {
    assert.equal(localDayKey(at(label), zone), "2010-11-08", label);
  }
});

test("DST transitions follow the IANA rules", () => {
  // UK springs forward 2010-03-28 01:00 UTC. 23:30 UTC on 03-27 is still GMT.
  assert.equal(localDayKey(at("2010-03-27T23:30:00Z"), "Europe/London"), "2010-03-27");
  // In October (BST, +01:00) 23:30 UTC is already the next day.
  assert.equal(localDayKey(at("2010-10-01T23:30:00Z"), "Europe/London"), "2010-10-02");
});

test("half-hour zones cross midnight at the half hour", () => {
  assert.equal(localDayKey(at("2010-01-01T18:29:00Z"), "Asia/Kolkata"), "2010-01-01");
  assert.equal(localDayKey(at("2010-01-01T18:31:00Z"), "Asia/Kolkata"), "2010-01-02");
});

test("territories take their own zone, not their owner's", () => {
  assert.equal(zoneForPoint(["PR", "US"], 18.4655, -66.1057), "America/Puerto_Rico");
});

test("multi-zone countries pick the nearest reference city", () => {
  assert.equal(zoneForPoint(["AU"], -31.95, 115.86), "Australia/Perth");
  assert.equal(zoneForPoint(["AU"], -33.87, 151.21), "Australia/Sydney");
  assert.equal(zoneForPoint(["US"], 40.7128, -74.006), "America/New_York");
});

test("regions without a zone fall back to the owner, then to longitude", () => {
  assert.equal(zoneForPoint(["FX", "FR"], 48.8566, 2.3522), "Europe/Paris");
  assert.equal(zoneForPoint([], -48.87, -123.39), "Etc/GMT+8"); // Point Nemo
  assert.equal(longitudeZone(0), "Etc/GMT");
  assert.equal(longitudeZone(139.7), "Etc/GMT-9"); // Etc signs are inverted
});

test("zone.tab coordinates parse in both precisions", () => {
  const zones = parseZoneTab(
    "# comment\nPR\t+182806-0660622\tAmerica/Puerto_Rico\nGB\t+513030-0000731\tEurope/London\nJP\t+353916+1394441\tAsia/Tokyo\nXX\t+4024-00341\tEurope/Madrid\n"
  );
  const pr = zones.get("PR")![0]!;
  assert.ok(Math.abs(pr.lat - 18.4683) < 0.001 && Math.abs(pr.lng + 66.1061) < 0.001);
  const madrid = zones.get("XX")![0]!;
  assert.ok(Math.abs(madrid.lat - 40.4) < 0.001 && Math.abs(madrid.lng + 3.6833) < 0.001);
});

test("every vendored zone is known to this runtime's ICU", () => {
  // An unknown zone would throw at count time, mid-report.
  const content = readFileSync(new URL("../src/geo/data/zone.tab", import.meta.url), "utf8");
  for (const entries of parseZoneTab(content).values()) {
    for (const { zone } of entries) {
      assert.doesNotThrow(() => localDayKey(0, zone), zone);
    }
  }
});
