import test from "node:test";
import assert from "node:assert/strict";
import { applicableServiceStandard } from "./onDemandServiceStandards";

test("uses the active Zone override and falls back to the all-zones default after expiry", () => {
  const policy = {
    defaultMinutes: 25,
    overrides: [{ zoneExternalLocationId: "central", minutes: 35, effectiveAt: "2026-08-24T08:00:00Z", expiresAt: "2026-08-24T20:00:00Z" }],
  };

  assert.equal(applicableServiceStandard(policy, "central", new Date("2026-08-24T12:00:00Z")), 35);
  assert.equal(applicableServiceStandard(policy, "central", new Date("2026-08-24T20:00:00Z")), 25);
  assert.equal(applicableServiceStandard(policy, "shakopee", new Date("2026-08-24T12:00:00Z")), 25);
});
