import { describe, expect, it } from "vitest";
import type { OtpAuditEntry, OtpReasonCode } from "@mvta/shared";
import { auditLine, auditLines, reasonLabeller, serviceDateLabel } from "./otpAuditEntries";

const codes: OtpReasonCode[] = [
  { id: "r1", code: "SCHED_RECOVERY", label: "Recovery point", applies_to: "stop", sort_order: 1, is_active: true, updated_by: null, updated_at: "" },
  { id: "r2", code: "WEATHER_SNOW", label: "Snow or ice", applies_to: "date", sort_order: 1, is_active: true, updated_by: null, updated_at: "" },
];

const stopEntry = (over: Partial<Extract<OtpAuditEntry, { kind: "stop_exclusion" }>> = {}): OtpAuditEntry => ({
  kind: "stop_exclusion", at: "2026-09-10T12:00:00.000Z", actor: "jane@example.com",
  reason_code: "SCHED_RECOVERY", route_id: 490, stop_id: 13209, day_of_week: "Monday",
  status: "approved", ...over,
});

const weatherEntry = (over: Partial<Extract<OtpAuditEntry, { kind: "weather_day" }>> = {}): OtpAuditEntry => ({
  kind: "weather_day", at: "2026-09-09T08:00:00.000Z", actor: "sam@example.com",
  reason_code: "WEATHER_SNOW", scope: "Agency", route_id: null, service_date: "20260908", ...over,
});

describe("wording an exclusion review entry", () => {
  const label = reasonLabeller(codes);

  it("shows the reason's label, not its code", () => {
    // The whole point of moving the wording here: the server has no access to
    // OtpReasonCodes, so the Audit Stream printed SCHED_RECOVERY where the
    // Review Queue printed "Recovery point" for the very same decision.
    expect(auditLine(stopEntry(), label).detail).toContain("Recovery point");
    expect(auditLine(stopEntry(), label).detail).not.toContain("SCHED_RECOVERY");
    expect(auditLine(weatherEntry(), label).detail).toContain("Snow or ice");
  });

  it("falls back to the raw code when nobody has labelled it", () => {
    expect(auditLine(stopEntry({ reason_code: "MADE_UP" }), label).detail).toContain("MADE_UP");
  });

  it("says so plainly when there is no reason at all", () => {
    expect(auditLine(stopEntry({ reason_code: null }), label).detail).toContain("no reason given");
    expect(auditLine(stopEntry({ reason_code: "" }), label).detail).toContain("no reason given");
  });

  it("distinguishes a stop that was excluded from one that was kept", () => {
    expect(auditLine(stopEntry({ status: "approved" }), label).title).toBe("Stop excluded");
    expect(auditLine(stopEntry({ status: "rejected" }), label).title).toBe("Stop kept in the figure");
  });

  it("names the route and stop of a decision, and who made it", () => {
    expect(auditLine(stopEntry(), label).detail).toBe(
      "Route 490 · Stop 13209 · Monday · Recovery point · by jane@example.com",
    );
  });

  it("reads a weather day by the date it happened, agency-wide or by route", () => {
    expect(auditLine(weatherEntry(), label).detail).toBe(
      "8 Sep 2026 · All routes · Snow or ice · by sam@example.com",
    );
    expect(auditLine(weatherEntry({ scope: "Route", route_id: 446 }), label).detail).toContain("Route 446");
  });

  it("keeps the moment the server reported, untouched", () => {
    expect(auditLine(stopEntry(), label).at).toBe("2026-09-10T12:00:00.000Z");
  });

  it("words a whole timeline against one set of reason codes", () => {
    const lines = auditLines([stopEntry(), weatherEntry()], codes);
    expect(lines.map((l) => l.title)).toEqual(["Stop excluded", "Weather day recorded"]);
  });
});

describe("reading a service date", () => {
  it("turns the stored YYYYMMDD into something a reviewer reads", () => {
    expect(serviceDateLabel("20260908")).toBe("8 Sep 2026");
    expect(serviceDateLabel("20261231")).toBe("31 Dec 2026");
    expect(serviceDateLabel("20260101")).toBe("1 Jan 2026");
  });

  it("leaves an unreadable value alone rather than inventing a date", () => {
    expect(serviceDateLabel("20261301")).toBe("20261301");
  });
});
