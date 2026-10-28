import test from "node:test";
import assert from "node:assert/strict";
import { evidenceServiceDate } from "./gtfsEvidenceServiceDate";

// Route 495's last trip, as dev saw it on 2026-10-22: scheduled 23:02 Central
// (82920 s), still reporting at 00:04 the next morning, sent without a
// start_date. The 23:02 run is 2026-10-22T04:02Z; the next one is a day later.
const LATE_TRIP = { first_departure_seconds: 82920, service_id: "weekday" };
const EVERY_DAY = () => true;

test("a late trip still running after midnight is filed under the day it started", () => {
  const justAfterMidnight = new Date("2026-10-22T05:04:27Z"); // 00:04 CDT on the 22nd
  assert.equal(evidenceServiceDate(justAfterMidnight, LATE_TRIP, EVERY_DAY), "20261021");
});

test("the same trip observed before midnight stays on the observation's day", () => {
  const beforeMidnight = new Date("2026-10-22T04:30:00Z"); // 23:30 CDT on the 21st
  assert.equal(evidenceServiceDate(beforeMidnight, LATE_TRIP, EVERY_DAY), "20261021");
});

test("a trip timed past 24:00 belongs to the previous service date", () => {
  // 24:30:00 on the 21st's schedule is 00:30 on the 22nd.
  const pastMidnight = { first_departure_seconds: 24 * 3600 + 30 * 60, service_id: "weekday" };
  const at = new Date("2026-10-22T05:20:00Z"); // 00:20 CDT on the 22nd
  assert.equal(evidenceServiceDate(at, pastMidnight, EVERY_DAY), "20261021");
});

test("an early-morning trip predicted before it starts stays on its own day", () => {
  const fiveAm = { first_departure_seconds: 5 * 3600, service_id: "weekday" };
  const at = new Date("2026-10-22T08:00:00Z"); // 03:00 CDT on the 22nd
  assert.equal(evidenceServiceDate(at, fiveAm, EVERY_DAY), "20261022");
});

test("only a date the trip's service runs on can be chosen", () => {
  // The 21st is not in this trip's calendar, so 00:04 on the 22nd cannot be
  // the 21st's run, however close its start would have been.
  const notOnThe21st = (serviceDate: string, serviceId: string) =>
    serviceId === "weekday" && serviceDate !== "20261021";
  const at = new Date("2026-10-22T05:04:27Z");
  assert.equal(evidenceServiceDate(at, LATE_TRIP, notOnThe21st), "20261022");
});

test("a trip the schedule does not know keeps the observation's date", () => {
  const at = new Date("2026-10-22T05:04:27Z");
  assert.equal(evidenceServiceDate(at, null, EVERY_DAY), "20261022");
});

test("a trip whose service runs on none of the nearby dates keeps the observation's date", () => {
  const at = new Date("2026-10-22T05:04:27Z");
  assert.equal(evidenceServiceDate(at, LATE_TRIP, () => false), "20261022");
});

test("the choice holds across the end of daylight saving time", () => {
  // 2026-11-01 is the fall-back day. The 23:02 run on Oct 31 is 04:02Z on Nov 1;
  // 06:04Z is 01:04 CDT, the last hour before the clocks go back.
  const at = new Date("2026-11-01T06:04:00Z");
  assert.equal(evidenceServiceDate(at, LATE_TRIP, EVERY_DAY), "20261031");
});
