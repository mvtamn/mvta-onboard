import assert from "node:assert/strict";
import test from "node:test";
import { assertSpareSlotsFilter, spareNumber, spareServiceName, spareString, spareTimestamp } from "./spareApi";

test("Spare field guards accept only bounded values of the expected type", () => {
  assert.equal(spareString(" request-1 ", 64), "request-1");
  assert.equal(spareString(123), null);
  assert.equal(spareNumber(1800), 1800);
  assert.equal(spareNumber("1800"), null);
});

test("Spare epoch timestamps are converted to UTC Date values", () => {
  assert.equal(spareTimestamp(1786201200)?.toISOString(), "2026-08-08T15:00:00.000Z");
  assert.equal(spareTimestamp(null), null);
});

test("Spare service names are read without retaining the rest of serviceBrand", () => {
  assert.equal(spareServiceName({ name: " MVTA Connect ", color: "#fff" }), "MVTA Connect");
  assert.equal(spareServiceName("MVTA Connect"), null);
});

test("requires a targeted Spare slots filter before issuing a request", () => {
  assert.throws(() => assertSpareSlotsFilter(new URLSearchParams()), /requires dutyId/);
  assert.doesNotThrow(() => assertSpareSlotsFilter(new URLSearchParams({ dutyId: "duty-7" })));
  assert.doesNotThrow(() => assertSpareSlotsFilter(new URLSearchParams({ requestId: "request-7" })));
  assert.doesNotThrow(() => assertSpareSlotsFilter(new URLSearchParams({ ids: "slot-7" })));
});
