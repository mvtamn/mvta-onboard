import { test } from "node:test";
import assert from "node:assert";
import { summaryFromCounts } from "./subscribersSummary";

test("an empty table (COUNT 0, every SUM NULL) yields zeros, not nulls", () => {
  assert.deepEqual(summaryFromCounts({ total: 0, sms_confirmed: null, email_confirmed: null, pending: null, opted_out: null }), {
    total: 0, sms_confirmed: 0, email_confirmed: 0, pending: 0, opted_out: 0,
  });
});

test("a missing row yields zeros", () => {
  assert.deepEqual(summaryFromCounts(undefined), { total: 0, sms_confirmed: 0, email_confirmed: 0, pending: 0, opted_out: 0 });
});

test("real counts pass through, numeric strings are converted", () => {
  assert.deepEqual(summaryFromCounts({ total: 12, sms_confirmed: "7", email_confirmed: 3, pending: 2, opted_out: 0 }), {
    total: 12, sms_confirmed: 7, email_confirmed: 3, pending: 2, opted_out: 0,
  });
});
