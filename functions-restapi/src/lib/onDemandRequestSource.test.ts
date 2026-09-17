import assert from "node:assert/strict";
import test from "node:test";
import { admitOnDemandRequest, readOnDemandRequestWindow, rereadOnDemandRequest } from "./onDemandRequestSource";
import type { OnDemandActivation } from "./onDemandMonitoringHealth";
import type { SparePage, SpareRequestRecord } from "./spareApi";

const NOW_SECONDS = 1_757_000_000;
const active: OnDemandActivation & { active: true } = { active: true, serviceIds: new Set(["svc-a"]) };

// A usable Spare request: an id, an update time and a pickup commitment.
function record(overrides: SpareRequestRecord = {}): SpareRequestRecord {
  return { id: "req-1", serviceId: "svc-a", updatedAt: NOW_SECONDS - 60, scheduledPickupTs: NOW_SECONDS + 600, ...overrides };
}

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

// --- admission: the one scope decision every writer goes through ---

test("admits a usable request for a monitored service, normalized", () => {
  const admission = admitOnDemandRequest(record(), active);
  assert.equal(admission.admit, true);
  assert.equal(admission.admit && admission.request.requestId, "req-1");
  assert.equal(admission.admit && admission.request.state, "active");
});

test("refuses a request for another service, or with no service at all", () => {
  assert.deepEqual(admitOnDemandRequest(record({ serviceId: "svc-b" }), active), { admit: false, reason: "out_of_scope" });
  assert.deepEqual(admitOnDemandRequest(record({ serviceId: undefined }), active), { admit: false, reason: "out_of_scope" });
});

test("refuses everything while monitoring is off or unscoped, whatever the record says", () => {
  assert.deepEqual(admitOnDemandRequest(record(), { active: false, reason: "disabled" }), { admit: false, reason: "disabled" });
  assert.deepEqual(admitOnDemandRequest(record(), { active: false, reason: "unscoped" }), { admit: false, reason: "unscoped" });
});

test("a record with no wait to monitor is unusable, not out of scope", () => {
  assert.deepEqual(admitOnDemandRequest(record({ scheduledPickupTs: undefined }), active), { admit: false, reason: "unusable" });
  assert.deepEqual(admitOnDemandRequest(record({ id: undefined }), active), { admit: false, reason: "unusable" });
});

// --- the authoritative window read ---

test("reads a bounded update window in a defined order, not the whole history", async () => {
  const { queries, fetchPage } = recorder([page([])]);
  await readOnDemandRequestWindow(active, NOW_SECONDS, fetchPage);
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
  await readOnDemandRequestWindow(active, NOW_SECONDS, fetchPage);
  assert.equal(queries[0]!.get("fromUpdatedAt"), String(NOW_SECONDS - 90 * 60));
});

test("hands back only admitted requests, and says how many Spare returned", async () => {
  const { fetchPage } = recorder([page([
    record({ id: "in-scope" }),
    record({ id: "other-service", serviceId: "svc-b" }),
    record({ id: "no-service", serviceId: undefined }),
    record({ id: "no-commitment", scheduledPickupTs: undefined }),
  ])]);
  const window = await readOnDemandRequestWindow(active, NOW_SECONDS, fetchPage);
  assert.equal(window.fetched, 4);
  assert.deepEqual(window.requests.map((request) => request.requestId), ["in-scope"]);
});

test("fails loudly when the window is larger than the row cap", async (t) => {
  process.env.ON_DEMAND_RECONCILE_MAX_ROWS = "2";
  t.after(() => { delete process.env.ON_DEMAND_RECONCILE_MAX_ROWS; });
  const { fetchPage } = recorder([page([record(), record()], 50)]);
  await assert.rejects(() => readOnDemandRequestWindow(active, NOW_SECONDS, fetchPage), /2-row safety cap/);
});

// --- the ETA re-read ---

test("an ETA re-read is admitted from the authoritative record, not the delivery", async () => {
  const reads: string[] = [];
  const fetchRequest = async (requestId: string) => { reads.push(requestId); return record({ id: requestId, serviceId: "svc-b" }); };
  assert.deepEqual(await rereadOnDemandRequest("req-9", active, fetchRequest), { admit: false, reason: "out_of_scope" });
  assert.deepEqual(reads, ["req-9"]);
});
