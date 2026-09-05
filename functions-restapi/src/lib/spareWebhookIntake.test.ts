import assert from "node:assert/strict";
import test from "node:test";
import { CachedValue, ContractSchemaLog, IntakeGate, VehicleWriteCoalescer } from "./spareWebhookIntake";

function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, tick: (ms: number) => { at += ms; } };
}

test("intake gate runs work inside the bound and sheds beyond it", async () => {
  const gate = new IntakeGate({ maxInFlight: 2, budgetMs: 1_000, cooldownMs: 1_000 });
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const first = gate.run(() => blocked.then(() => "a"));
  const second = gate.run(() => blocked.then(() => "b"));
  const third = await gate.run(async () => "c");
  assert.deepEqual(third, { kind: "shed", reason: "in_flight" });
  release();
  assert.deepEqual(await first, { kind: "done", value: "a" });
  assert.deepEqual(await second, { kind: "done", value: "b" });
  assert.equal(gate.state.inFlight, 0);
});

test("a delivery over budget fails, cools the gate, and the gate reopens after the cool-down", async () => {
  const c = clock();
  const gate = new IntakeGate({ maxInFlight: 4, budgetMs: 20, cooldownMs: 5_000, now: c.now });
  const slow = await gate.run(() => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 80)));
  assert.deepEqual(slow, { kind: "failed", reason: "timeout" });
  assert.deepEqual(await gate.run(async () => "x"), { kind: "shed", reason: "cooling_down" });
  c.tick(5_001);
  assert.deepEqual(await gate.run(async () => "x"), { kind: "done", value: "x" });
});

test("a thrown error cools the gate and is reported, not swallowed", async () => {
  const c = clock();
  const gate = new IntakeGate({ maxInFlight: 4, budgetMs: 1_000, cooldownMs: 1_000, now: c.now });
  const boom = new Error("pool wedged");
  const failed = await gate.run(async () => { throw boom; });
  assert.equal(failed.kind, "failed");
  assert.equal(failed.kind === "failed" && failed.error, boom);
  assert.equal(gate.state.coolingDown, true);
  assert.equal(gate.state.inFlight, 0);
});

test("vehicle writes are coalesced per duty and vehicle within the interval", () => {
  const c = clock();
  const coalescer = new VehicleWriteCoalescer(60_000, c.now);
  assert.equal(coalescer.shouldWrite("duty-1", "veh-1"), true);
  c.tick(10_000);
  assert.equal(coalescer.shouldWrite("duty-1", "veh-1"), false, "same vehicle ten seconds later carries no new fact");
  assert.equal(coalescer.shouldWrite("duty-1", "veh-2"), true, "a vehicle change is always written");
  assert.equal(coalescer.shouldWrite("duty-2", "veh-1"), true, "another duty is independent");
  c.tick(60_000);
  assert.equal(coalescer.shouldWrite("duty-1", "veh-2"), true, "the interval has elapsed");
});

test("the coalescer's memory stays bounded", () => {
  const c = clock();
  const coalescer = new VehicleWriteCoalescer(60_000, c.now, 3);
  for (let i = 0; i < 10; i++) coalescer.shouldWrite(`duty-${i}`, "veh");
  // Nothing observable except that it keeps answering; the oldest entries
  // are gone, so an old duty is treated as new again.
  assert.equal(coalescer.shouldWrite("duty-0", "veh"), true);
});

test("contract schema is new once per event type and field set", () => {
  const log = new ContractSchemaLog();
  const schema = { envelope_fields: ["data", "type"], data_fields: ["dutyId", "vehicleId"] };
  assert.equal(log.isNew("vehicleLocation", schema), true);
  assert.equal(log.isNew("vehicleLocation", { ...schema }), false);
  assert.equal(log.isNew("requestStatus", schema), true, "same fields under another type is still news");
  assert.equal(log.isNew("vehicleLocation", { ...schema, data_fields: ["dutyId"] }), true);
});

test("cached value reloads after the ttl and serves the last good value when a reload fails", async () => {
  const c = clock();
  let loads = 0;
  let fail = false;
  const cached = new CachedValue(async () => { loads++; if (fail) throw new Error("db down"); return `v${loads}`; }, 60_000, c.now);
  assert.equal(await cached.get(), "v1");
  assert.equal(await cached.get(), "v1");
  assert.equal(loads, 1);
  c.tick(60_001);
  fail = true;
  assert.equal(await cached.get(), "v1", "stale beats a fault");
  fail = false;
  // The failed attempt counted as a load, so the next good value is the third.
  assert.equal(await cached.get(), "v3");
  assert.equal(loads, 3);
});

test("cached value fails through when there is nothing to serve", async () => {
  const cached = new CachedValue(async () => { throw new Error("db down"); }, 60_000);
  await assert.rejects(cached.get(), /db down/);
});
