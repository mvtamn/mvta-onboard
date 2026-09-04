import { describe, expect, it } from "vitest";
import type { Detour, DetourCommunication } from "@mvta/shared";
import { audiencePlan, communicationSubject, draftCommunicationText, mailtoLink, nextAudience } from "./detourCommunicationDraft.js";

const detour = {
  internal_number: "MVTA-DET-2026-0012", number: null, closure: "Cedar Ave bridge closed", location: "Cedar Ave at 5th St",
  start_date: "2026-09-10", end_date: null, start_time: "06:00", end_time: "19:00", time_window_status: "estimated",
  segments: [{ id: "s1", detour_id: "d", routes: "460 SB", directions: "Via Nicollet to 6th", sort_order: 0 }],
  action_instructions: "Follow the posted detour.", riders_directed: "Use the stop at 6th St", affected_stops_and_stations: null,
  operational_impacts: null, confirmation_contact: "Project office 555-0100",
  notification_audiences: ["Operators", "Operations management"], notification_channels: ["email", "radio"],
} as unknown as Detour;

function comm(audience: string, status: DetourCommunication["status"]): DetourCommunication {
  return { id: `${audience}-${status}`, detour_id: "d", audience, channel: "email", recipients: null, content: "x", status, outcome: null, created_by: "a", created_at: "", published_by: null, published_at: null };
}

describe("audiencePlan", () => {
  it("reports each required audience's progress, matching case-insensitively", () => {
    const plan = audiencePlan(detour, [comm("operators", "published"), comm("Operations management", "draft")]);
    expect(plan.map((p) => [p.audience, p.progress])).toEqual([["Operators", "published"], ["Operations management", "draft"]]);
    expect(plan[0].channels).toEqual(["email", "radio"]);
  });
  it("opens on the first audience with nothing yet, then on drafts", () => {
    expect(nextAudience(audiencePlan(detour, [comm("Operators", "published")]))?.audience).toBe("Operations management");
    expect(nextAudience(audiencePlan(detour, [comm("Operators", "draft"), comm("Operations management", "published")]))?.audience).toBe("Operators");
    expect(nextAudience(audiencePlan(detour, [comm("Operators", "published"), comm("Operations management", "published")]))).toBeNull();
  });
  it("uses the server's required list and marks the contractor as email-to-recipients", () => {
    const plan = audiencePlan({ ...detour, required_audiences: ["Operators", "SST"] }, [], { name: "SST", recipients: ["ops@sst.com"] });
    expect(plan.map((p) => p.audience)).toEqual(["Operators", "SST"]);
    expect(plan[0].contractor).toBe(false);
    expect(plan[1]).toMatchObject({ contractor: true, channels: ["email"], recipients: ["ops@sst.com"] });
  });
  it("is empty when the record names no audiences", () => {
    expect(audiencePlan({ notification_audiences: [], notification_channels: [] }, [])).toEqual([]);
  });
});

describe("draftCommunicationText", () => {
  it("assembles the record into a message, addressed to the audience", () => {
    const text = draftCommunicationText(detour, "Operators");
    expect(text.startsWith("To Operators\n\nMVTA-DET-2026-0012: Cedar Ave bridge closed")).toBe(true);
    expect(text).toContain("Location: Cedar Ave at 5th St");
    expect(text).toContain("until further notice 06:00–19:00 (estimated)");
    expect(text).toContain("Routes: 460 SB");
    expect(text).toContain("Action: Follow the posted detour.");
    expect(text).toContain("460 SB: Via Nicollet to 6th");
    expect(text).toContain("Questions: Project office 555-0100");
  });
  it("omits lines the record does not have and never emits a blank-dated closure as a date", () => {
    const text = draftCommunicationText({ ...detour, internal_number: null, location: null, start_date: null, end_date: null, start_time: null, end_time: null, time_window_status: null, segments: [], action_instructions: null, riders_directed: null, confirmation_contact: null });
    expect(text).toBe("Cedar Ave bridge closed\nWhen: Dates to be confirmed");
  });
});

describe("mailtoLink and communicationSubject", () => {
  it("builds a mailto with encoded recipients, subject, and body", () => {
    const link = mailtoLink(["a@sst.com", "b@sst.com"], "Detour: 5th & Main", "Line 1\nLine 2");
    expect(link.startsWith("mailto:a%40sst.com%2Cb%40sst.com?subject=Detour%3A%205th%20%26%20Main&body=Line%201%0ALine%202")).toBe(true);
  });
  it("prefixes the subject with the reference when there is one", () => {
    expect(communicationSubject(detour)).toBe("[MVTA-DET-2026-0012] Detour: Cedar Ave bridge closed");
    expect(communicationSubject({ internal_number: null, number: null, closure: "X" })).toBe("Detour: X");
  });
});
