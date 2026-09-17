import assert from "node:assert/strict";
import test from "node:test";
import { assertSpareSlotsFilter, fetchSpareCollection, fetchSpareUpdatedWindow, positiveEnvInteger, spareNumber, spareServiceName, spareString, spareTimestamp, type SparePage } from "./spareApi";

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

test("pages a bounded window until the reported total is reached", async () => {
  const pages: SparePage<{ id: string }>[] = [
    { total: 3, limit: 2, skip: 0, data: [{ id: "a" }, { id: "b" }] },
    { total: 3, limit: 2, skip: 2, data: [{ id: "c" }] },
  ];
  const skips: string[] = [];
  let call = 0;
  const rows = await fetchSpareUpdatedWindow<{ id: string }>(
    100, 200, 2, 100,
    async (_path, query) => {
      skips.push(query.get("skip")!);
      return pages[call++] as never;
    },
  );
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
  assert.deepEqual(skips, ["0", "2"]);
});

test("pages a duty's slots with the same loop, filter and order as requests", async () => {
  // The missed-trip ingest used to carry its own copy of this loop.
  const queries: URLSearchParams[] = [];
  const pages: SparePage<{ id: string }>[] = [
    { total: 3, limit: 2, skip: 0, data: [{ id: "s1" }, { id: "s2" }] },
    { total: 3, limit: 2, skip: 2, data: [{ id: "s3" }] },
  ];
  let call = 0;
  const rows = await fetchSpareCollection<{ id: string }>("/v1/slots", { dutyId: "duty-1", type: "pickup" }, 2, 100,
    async (path, query) => { assert.equal(path, "/v1/slots"); queries.push(query); return pages[call++] as never; });
  assert.deepEqual(rows.map((row) => row.id), ["s1", "s2", "s3"]);
  assert.equal(queries[0].get("dutyId"), "duty-1");
  assert.equal(queries[0].get("type"), "pickup");
  assert.equal(queries[0].get("orderDirection"), "ASC");
  assert.deepEqual(queries.map((query) => query.get("skip")), ["0", "2"]);
});

test("a read Spare would have truncated throws instead of returning part of it", async () => {
  // The departures poll read one page of start slots and dropped the rest.
  await assert.rejects(
    fetchSpareCollection("/v1/slots", { dutyId: "duty-1", type: "startLocation" }, 20, 20,
      async () => ({ total: 23, limit: 20, skip: 0, data: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` })) }) as never),
    /Spare \/v1\/slots read exceeded the 20-row safety cap/,
  );
});

test("an environment override outside the allowed range falls back", () => {
  process.env.SPARE_TEST_INT = "0";
  assert.equal(positiveEnvInteger("SPARE_TEST_INT", 7, 10), 7);
  process.env.SPARE_TEST_INT = "99";
  assert.equal(positiveEnvInteger("SPARE_TEST_INT", 7, 10), 10);
  delete process.env.SPARE_TEST_INT;
  assert.equal(positiveEnvInteger("SPARE_TEST_INT", 7, 10), 7);
});
