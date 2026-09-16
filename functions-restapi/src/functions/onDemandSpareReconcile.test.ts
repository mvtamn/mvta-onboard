import assert from "node:assert/strict";
import test from "node:test";
import { fetchAuthoritativeRequests } from "./onDemandSpareReconcile";
import type { SparePage } from "../lib/spareApi";

const NOW_SECONDS = 1_757_000_000;

function recorder(pages: SparePage<unknown>[]) {
  const queries: URLSearchParams[] = [];
  let call = 0;
  const fetchPage = async <T>(_path: string, query: URLSearchParams): Promise<SparePage<T>> => {
    queries.push(query);
    return (pages[call++] ?? { total: 0, limit: 200, skip: 0, data: [] }) as SparePage<T>;
  };
  return { queries, fetchPage };
}

function page(data: unknown[], total = data.length): SparePage<unknown> {
  return { total, limit: 200, skip: 0, data };
}

test("reads a bounded update window in a defined order, not the whole history", async () => {
  const { queries, fetchPage } = recorder([page([])]);
  await fetchAuthoritativeRequests(new Set(["svc-a"]), NOW_SECONDS, fetchPage);
  const query = queries[0]!;
  assert.equal(query.get("toUpdatedAt"), String(NOW_SECONDS));
  // The default lookback is 24 hours.
  assert.equal(query.get("fromUpdatedAt"), String(NOW_SECONDS - 24 * 60 * 60));
  assert.equal(query.get("orderBy"), "updatedAt");
  assert.equal(query.get("orderDirection"), "ASC");
});

test("honours a configured lookback", async (t) => {
  process.env.ON_DEMAND_RECONCILE_LOOKBACK_MINUTES = "90";
  t.after(() => { delete process.env.ON_DEMAND_RECONCILE_LOOKBACK_MINUTES; });
  const { queries, fetchPage } = recorder([page([])]);
  await fetchAuthoritativeRequests(new Set(["svc-a"]), NOW_SECONDS, fetchPage);
  assert.equal(queries[0]!.get("fromUpdatedAt"), String(NOW_SECONDS - 90 * 60));
});

test("keeps only requests belonging to the scoped services", async () => {
  const { fetchPage } = recorder([page([
    { id: "in-scope", serviceId: "svc-a" },
    { id: "other-service", serviceId: "svc-b" },
    { id: "no-service" },
  ])]);
  const rows = await fetchAuthoritativeRequests(new Set(["svc-a"]), NOW_SECONDS, fetchPage);
  assert.deepEqual(rows.map((row) => row.id), ["in-scope"]);
});

test("fails loudly when the window is larger than the row cap", async (t) => {
  process.env.ON_DEMAND_RECONCILE_MAX_ROWS = "2";
  t.after(() => { delete process.env.ON_DEMAND_RECONCILE_MAX_ROWS; });
  const { fetchPage } = recorder([page([{ serviceId: "svc-a" }, { serviceId: "svc-a" }], 50)]);
  await assert.rejects(
    () => fetchAuthoritativeRequests(new Set(["svc-a"]), NOW_SECONDS, fetchPage),
    /2-row safety cap/,
  );
});
