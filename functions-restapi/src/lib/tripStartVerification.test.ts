import test from "node:test";
import assert from "node:assert/strict";
import { initialsFor, validateVerificationInput } from "./tripStartVerification";

test("accepts the workbook's three observations and clear, and nothing else", () => {
  const ok = validateVerificationInput({ service_date: "20260908", trip_id: "t1", action: "observed_left_late", note: "  left 3 late  " });
  assert.deepEqual(ok, { ok: true, value: { service_date: "20260908", trip_id: "t1", action: "observed_left_late", note: "left 3 late", initials: null } });
  const clear = validateVerificationInput({ service_date: "20260908", trip_id: "t1", action: "clear" });
  assert.equal(clear.ok, true);
  const bad = validateVerificationInput({ service_date: "2026-09-08", trip_id: "", action: "late" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.length, 3);
});

test("cleans requested initials to letters and caps their length", () => {
  const v = validateVerificationInput({ service_date: "20260908", trip_id: "t1", action: "observed_on_time", initials: " j.d " });
  assert.equal(v.ok && v.value.initials, "JD");
  const long = validateVerificationInput({ service_date: "20260908", trip_id: "t1", action: "observed_on_time", initials: "ABCDEFGHIJK" });
  assert.equal(long.ok, false);
});

test("derives initials from the display name, then the sign-in name, and lets the caller override", () => {
  assert.equal(initialsFor("Jane Doe", "jane.doe@sst.example", null), "JD");
  assert.equal(initialsFor("Doe, Jane", "jane.doe@sst.example", null), "JD");
  assert.equal(initialsFor(undefined, "jane.doe@sst.example", null), "JD");
  assert.equal(initialsFor(undefined, "jdoe@sst.example", null), "J");
  assert.equal(initialsFor("Jane Doe", "jane.doe@sst.example", "JMD"), "JMD");
  assert.equal(initialsFor(undefined, undefined, null), "?");
});
