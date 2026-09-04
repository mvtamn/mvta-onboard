import { describe, expect, it } from "vitest";
import type { DetourCommunication } from "@mvta/shared";
import { deliveryClass, deliveryLabel } from "../components/DetourDeliveryRecord.js";

function comm(overrides: Partial<DetourCommunication>): DetourCommunication {
  return { id: "c", detour_id: "d", audience: "Operators", channel: "email", recipients: "a@x", content: "x", status: "draft", outcome: null, created_by: "u", created_at: "", published_by: null, published_at: null, ...overrides };
}

describe("deliveryLabel", () => {
  it("names server delivery states, with Posted for Teams", () => {
    expect(deliveryLabel(comm({ delivery_status: "queued" }))).toBe("Sending…");
    expect(deliveryLabel(comm({ delivery_status: "sent", delivery_completed_at: null }))).toBe("Delivered");
    expect(deliveryLabel(comm({ channel: "Teams", delivery_status: "sent", delivery_completed_at: null }))).toBe("Posted");
    expect(deliveryLabel(comm({ delivery_status: "partially_sent" }))).toBe("Partially delivered");
    expect(deliveryLabel(comm({ delivery_status: "failed" }))).toBe("Delivery failed");
    expect(deliveryLabel(comm({ delivery_status: "skipped" }))).toBe("Delivery not available");
  });
  it("falls back to the human-recorded outcome when the server never sent it", () => {
    expect(deliveryLabel(comm({ status: "published", outcome: "Sent by email to a@x" }))).toBe("Sent by email to a@x");
    expect(deliveryLabel(comm({ status: "published", outcome: null }))).toBe("Recorded as sent");
    expect(deliveryLabel(comm({ status: "draft" }))).toBe("Draft");
  });
  it("classes success, failure, and neutral states", () => {
    expect(deliveryClass(comm({ delivery_status: "sent" }))).toBe("ok-text");
    expect(deliveryClass(comm({ delivery_status: "failed" }))).toBe("warn-note");
    expect(deliveryClass(comm({ delivery_status: "queued" }))).toBe("td-dim");
  });
});
