import test from "node:test";
import assert from "node:assert/strict";
import { eventNotificationClaimSql } from "./eventNotificationDelivery";

test("notification delivery claims are atomic and recover only an expired lease", () => {
  const manual = eventNotificationClaimSql("manual");
  const automatic = eventNotificationClaimSql("automatic");
  assert.match(manual, /UPDATE EventGeofenceNotifications/);
  assert.match(manual, /status IN \('pending','acknowledged'\)/);
  assert.match(automatic, /status IN \('pending'\)/);
  assert.match(manual, /status='sending' AND delivery_claimed_at < DATEADD\(MINUTE,-5/);
});
