import assert from "node:assert/strict";
import test from "node:test";
import { mergeAuditEntries, timelineLimit, type StopExclusionRecord, type WeatherDayRecord } from "./index";

const stop = (over: Partial<StopExclusionRecord> = {}): StopExclusionRecord => ({
  id: "s1", service_month: "202609", route_id: 490, stop_id: 13209, day_of_week: "Monday",
  status: "approved", reason_code: "SCHED_RECOVERY", reviewed_by: "jane@example.com",
  reviewed_at: new Date("2026-09-10T12:00:00Z"), ...over,
});

const weather = (over: Partial<WeatherDayRecord> = {}): WeatherDayRecord => ({
  id: "w1", scope: "Agency", route_id: null, service_date: "20260908",
  reason_code: "WEATHER_SNOW", notes: null, status: "Approved", notified: false,
  notified_at: null, acknowledged: false, created_by: "sam@example.com",
  created_at: new Date("2026-09-09T08:00:00Z"), ...over,
});

test("the two kinds interleave by when each happened, newest first", () => {
  const entries = mergeAuditEntries(
    [stop({ reviewed_at: new Date("2026-09-01T00:00:00Z") }),
     stop({ id: "s2", reviewed_at: new Date("2026-09-20T00:00:00Z") })],
    [weather({ created_at: new Date("2026-09-10T00:00:00Z") })],
    50,
  );
  assert.deepEqual(entries.map((e) => e.at), [
    "2026-09-20T00:00:00.000Z",
    "2026-09-10T00:00:00.000Z",
    "2026-09-01T00:00:00.000Z",
  ]);
  assert.deepEqual(entries.map((e) => e.kind), ["stop_exclusion", "weather_day", "stop_exclusion"]);
});

test("each kind reads the timestamp its own table carries", () => {
  // reviewed_at for a decision about a stop; created_at for a weather day.
  // Sorting one by the other's column would silently order by nothing.
  const [s] = mergeAuditEntries([stop()], [], 50);
  const [w] = mergeAuditEntries([], [weather()], 50);
  assert.equal(s?.at, "2026-09-10T12:00:00.000Z");
  assert.equal(w?.at, "2026-09-09T08:00:00.000Z");
});

test("an entry carries the facts, not a sentence", () => {
  const [entry] = mergeAuditEntries([stop({ status: "rejected", reason_code: null })], [], 50);
  assert.deepEqual(entry, {
    kind: "stop_exclusion",
    at: "2026-09-10T12:00:00.000Z",
    actor: "jane@example.com",
    reason_code: null,
    route_id: 490,
    stop_id: 13209,
    day_of_week: "Monday",
    status: "rejected",
  });
  // The handler used to build "Route 490 · Stop 13209 · Monday · ... · by
  // jane" here, which is why the stream showed a raw reason code where the
  // Review Queue showed its label. Wording is the console's now.
  assert.equal("title" in entry!, false);
  assert.equal("desc" in entry!, false);
});

test("a weather day carries its scope and the date it happened", () => {
  const [entry] = mergeAuditEntries([], [weather({ scope: "Route", route_id: 446 })], 50);
  assert.equal(entry?.kind, "weather_day");
  assert.deepEqual(
    entry?.kind === "weather_day" ? [entry.scope, entry.route_id, entry.service_date] : null,
    ["Route", 446, "20260908"],
  );
});

test("the limit applies to the merged list, not to each kind", () => {
  const stops = [1, 2, 3].map((n) => stop({ id: `s${n}`, reviewed_at: new Date(`2026-09-0${n}T00:00:00Z`) }));
  const days = [4, 5, 6].map((n) => weather({ id: `w${n}`, created_at: new Date(`2026-09-0${n}T00:00:00Z`) }));
  const entries = mergeAuditEntries(stops, days, 2);
  assert.equal(entries.length, 2);
  // The two newest across both kinds - the 6th and the 5th of September.
  assert.deepEqual(entries.map((e) => e.at), ["2026-09-06T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]);
});

test("a limit of zero or less yields nothing rather than everything", () => {
  assert.deepEqual(mergeAuditEntries([stop()], [weather()], 0), []);
  assert.deepEqual(mergeAuditEntries([stop()], [weather()], -5), []);
});

test("an absent or unusable limit falls back to the default, and a large one is clamped", () => {
  assert.equal(timelineLimit(undefined), 50);
  assert.equal(timelineLimit(Number.NaN), 50);
  assert.equal(timelineLimit(0), 50);
  assert.equal(timelineLimit(-1), 50);
  assert.equal(timelineLimit(6), 6);
  assert.equal(timelineLimit(10.9), 10);
  assert.equal(timelineLimit(10_000), 200);
});
