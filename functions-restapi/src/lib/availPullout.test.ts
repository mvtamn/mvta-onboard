import { test } from "node:test";
import assert from "node:assert";
import {
  fetchPulloutReports,
  mapPulloutReport,
  unknownPulloutStatuses,
  type AvailPulloutReport,
} from "./availPullout";

// Fixtures shaped like the owner's sample Avail360 Pullout Reports payload.
const LATE_RELIEF: AvailPulloutReport = {
  Block: 11801,
  Run: 1811,
  Checkin_Scheduled: "2026-02-23T12:35:00Z",
  Checkin_Actual: null,
  Login_Scheduled: "2026-02-23T12:40:00Z",
  Login_Actual: "2026-02-23T12:52:25Z",
  Pullout_Scheduled: "2026-02-23T12:50:00Z",
  Pullout_Actual: "2026-02-23T12:52:55Z",
  PulloutStatus: "Late Relief",
  OperatorName: "HAWTHORNE, PORSCHE -144",
  LogonID: 41901,
  VehicleLabel: "1910",
};

const EXPIRED_PULLOUT: AvailPulloutReport = {
  Block: 10012,
  Run: 1012,
  Checkin_Scheduled: "2026-02-23T15:20:00Z",
  Checkin_Actual: null,
  Login_Scheduled: "2026-02-23T15:25:00Z",
  Login_Actual: null,
  Pullout_Scheduled: "2026-02-23T15:35:00Z",
  Pullout_Actual: null,
  PulloutStatus: "Expired Pullout",
  OperatorName: null,
  LogonID: null,
  VehicleLabel: null,
};

test("fetches the confirmed property-level Pullout path without a date suffix", async () => {
  let requestedUrl = "";
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, errors: [], result: { Pullout: [] } }),
    };
  }) as unknown as typeof fetch;
  try {
    await fetchPulloutReports("https://example.test/Pullout/v1/MVTA/", "key");
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(requestedUrl, "https://example.test/Pullout/v1/MVTA");
});

test("maps a Late Relief pullout report", () => {
  const mapped = mapPulloutReport(LATE_RELIEF);
  assert.ok(mapped);
  assert.strictEqual(mapped!.block, 11801);
  assert.strictEqual(mapped!.run, 1811);
  assert.strictEqual(mapped!.checkin_scheduled?.toISOString(), "2026-02-23T12:35:00.000Z");
  assert.strictEqual(mapped!.checkin_actual, null);
  assert.strictEqual(mapped!.login_actual?.toISOString(), "2026-02-23T12:52:25.000Z");
  assert.strictEqual(mapped!.pullout_scheduled?.toISOString(), "2026-02-23T12:50:00.000Z");
  assert.strictEqual(mapped!.pullout_actual?.toISOString(), "2026-02-23T12:52:55.000Z");
  assert.strictEqual(mapped!.pullout_status, "Late Relief");
  assert.strictEqual(mapped!.operator_name, "HAWTHORNE, PORSCHE -144");
  assert.strictEqual(mapped!.logon_id, 41901);
  assert.strictEqual(mapped!.vehicle_label, "1910");
});

test("maps a null-heavy Expired Pullout report", () => {
  const mapped = mapPulloutReport(EXPIRED_PULLOUT);
  assert.ok(mapped);
  assert.strictEqual(mapped!.block, 10012);
  assert.strictEqual(mapped!.run, 1012);
  assert.strictEqual(mapped!.checkin_actual, null);
  assert.strictEqual(mapped!.login_actual, null);
  assert.strictEqual(mapped!.pullout_actual, null);
  assert.strictEqual(mapped!.pullout_status, "Expired Pullout");
  assert.strictEqual(mapped!.operator_name, null);
  assert.strictEqual(mapped!.logon_id, null);
  assert.strictEqual(mapped!.vehicle_label, null);
});

test("returns null when Block or Run is missing/non-numeric", () => {
  assert.strictEqual(mapPulloutReport({ ...LATE_RELIEF, Block: undefined as unknown as number }), null);
  assert.strictEqual(mapPulloutReport({ ...LATE_RELIEF, Run: undefined as unknown as number }), null);
});

test("treats an unparseable timestamp as null rather than throwing", () => {
  const mapped = mapPulloutReport({ ...LATE_RELIEF, Pullout_Actual: "not-a-date" });
  assert.ok(mapped);
  assert.strictEqual(mapped!.pullout_actual, null);
});

// --- service-date key -----------------------------------------------------
// The Pullout endpoint carries no date, so service_date is derived - and it is
// part of the (service_date, block, run) MERGE key. Deriving it from the poll
// clock in UTC re-keyed the same run mid-service (the UTC day rolls over at
// 6/7pm agency-local, while service runs to 10pm), inserting a duplicate row
// that double-counted the run in the late/expired totals.

test("derives the service date from the run's scheduled pullout, in agency time", () => {
  // 12:50Z on 2026-02-23 is 06:50 CST the same local day.
  const mapped = mapPulloutReport(LATE_RELIEF);
  assert.strictEqual(mapped!.service_date, "20260223");
});

test("keeps one service date for a run across polls that straddle the UTC rollover", () => {
  const morningPoll = mapPulloutReport(LATE_RELIEF, new Date("2026-02-23T14:00:00Z")); // 08:00 CST
  const eveningPoll = mapPulloutReport(LATE_RELIEF, new Date("2026-02-24T02:00:00Z")); // 20:00 CST, still 2/23 locally
  assert.strictEqual(morningPoll!.service_date, "20260223");
  assert.strictEqual(
    eveningPoll!.service_date,
    morningPoll!.service_date,
    "an evening poll must MERGE onto the same key, not insert a second row",
  );
});

test("anchors to the local date even when the scheduled pullout is a late-evening UTC value", () => {
  // 2026-08-24T02:15:00Z is 21:15 CDT on 2026-08-23 - the UTC date has already
  // advanced, the agency-local service date has not.
  const mapped = mapPulloutReport({ ...LATE_RELIEF, Pullout_Scheduled: "2026-08-24T02:15:00Z" });
  assert.strictEqual(mapped!.service_date, "20260823");
});

test("falls back through scheduled, then actual, then the poll clock", () => {
  const noPulloutScheduled = mapPulloutReport({ ...LATE_RELIEF, Pullout_Scheduled: null });
  assert.strictEqual(noPulloutScheduled!.service_date, "20260223", "falls back to Login_Scheduled");

  const actualsOnly = mapPulloutReport({
    ...LATE_RELIEF,
    Checkin_Scheduled: null,
    Login_Scheduled: null,
    Pullout_Scheduled: null,
  });
  assert.strictEqual(actualsOnly!.service_date, "20260223", "falls back to Pullout_Actual");

  const noTimes = mapPulloutReport(
    {
      ...LATE_RELIEF,
      Checkin_Scheduled: null,
      Checkin_Actual: null,
      Login_Scheduled: null,
      Login_Actual: null,
      Pullout_Scheduled: null,
      Pullout_Actual: null,
    },
    new Date("2026-02-24T02:00:00Z"),
  );
  assert.strictEqual(noTimes!.service_date, "20260223", "last resort is the poll clock, in agency time");
});

test("an unparseable scheduled pullout does not poison the service date", () => {
  const mapped = mapPulloutReport({ ...LATE_RELIEF, Pullout_Scheduled: "not-a-date" });
  assert.strictEqual(mapped!.pullout_scheduled, null);
  assert.strictEqual(mapped!.service_date, "20260223");
});

// --- unknown status detection ----------------------------------------------
// The compliance rule's status allowlist raises nothing for a value it does not
// recognise, and does not error doing it. This is what makes that visible.

function reportWithStatus(status: string | null): AvailPulloutReport {
  return { ...LATE_RELIEF, PulloutStatus: status };
}

test("reports a status nothing accounts for", () => {
  assert.deepEqual(unknownPulloutStatuses([reportWithStatus("Pullout Deferred")]), ["Pullout Deferred"]);
});

test("reports a status MVTA's configuration cannot currently produce", () => {
  // The event worth hearing about: an unreachable status becoming reachable
  // because MVTA adopted an operator scheduling package. These five are absent
  // from the known set precisely so that arrival is announced, with whatever
  // spelling the feed actually uses, rather than assumed.
  assert.deepEqual(
    unknownPulloutStatuses([
      reportWithStatus("Missing Operator Assignment"),
      reportWithStatus("Missed Check-in"),
    ]),
    ["Missed Check-in", "Missing Operator Assignment"],
  );
});

test("stays quiet for every status the feed is known to send", () => {
  const known = [
    "Missed Pullout", "Missed Login", "Expired Pullout", "Late Pullout",
    "On Time Pullout", "On Route No Pullout", "Late Relief",
    "On Time Pullin", "Late Pullin", "Missed Pullin", "Waiting for Pullin",
    "Tripper", "Waiting for Pullout", "Late Login",
  ].map(reportWithStatus);
  assert.deepEqual(unknownPulloutStatuses(known), []);
});

test("a case difference is not a finding", () => {
  // The rule matches in SQL, whose collation is case-insensitive, so a value
  // differing only in case still works. Reporting it would be noise.
  assert.deepEqual(unknownPulloutStatuses([reportWithStatus("MISSED LOGIN")]), []);
});

test("a blank status is Avail still resolving a run, not an unknown one", () => {
  assert.deepEqual(unknownPulloutStatuses([reportWithStatus(""), reportWithStatus(null)]), []);
});

test("reports each unrecognised value once, however many rows carry it", () => {
  // 145 reports arrive every five minutes; one line per delivery, not per row.
  const reports = [
    reportWithStatus("Pullout Deferred"),
    reportWithStatus("Pullout Deferred"),
    reportWithStatus("  Pullout Deferred  "),
    reportWithStatus("Yard Hold"),
    reportWithStatus("Late Pullin"),
  ];
  assert.deepEqual(unknownPulloutStatuses(reports), ["Pullout Deferred", "Yard Hold"]);
});
