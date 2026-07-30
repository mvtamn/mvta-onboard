import { test } from "node:test";
import assert from "node:assert";
import { mapPulloutReport, type AvailPulloutReport } from "./availPullout";

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
