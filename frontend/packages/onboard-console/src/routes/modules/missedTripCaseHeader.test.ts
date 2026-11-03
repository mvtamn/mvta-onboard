import { describe, expect, it } from "vitest";
import type { GtfsCaseEvidence, SpareCaseTimes } from "@mvta/shared";
import { caseHeader, countingLine } from "./missedTripCaseHeader.js";
import { attributionHelp } from "./missedTripReview.js";
import type { MissedTripAlert } from "./missedTrips.data.js";

// UTC clock, so the expectations do not depend on the machine's zone.
const time = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");

type HeaderInput = Parameters<typeof caseHeader>[0];

function gtfs(evidence: GtfsCaseEvidence | null, overrides: Partial<HeaderInput> = {}): HeaderInput {
  return {
    sourceSystem: "gtfs",
    detectionType: "silent_no_show",
    evidenceFinding: "suspected_no_show",
    dataQualityStatus: "experimental",
    detectorVersion: "gtfs-silent-v4",
    scheduledDepartureAt: "2026-10-31T22:01:00.000Z",
    graceDeadlineAt: "2026-10-31T22:31:00.000Z",
    firstSeenWatchingAt: "2026-10-31T22:35:00.000Z",
    detectedLateArrivalAt: null,
    tripId: "t6A5-b22C-sl1B-v64",
    startDelaySeconds: null,
    arrivalDelaySeconds: null,
    gtfsEvidence: evidence,
    spareTimes: null,
    detectorPromoted: false,
    ...overrides,
  };
}

function evidence(overrides: Partial<GtfsCaseEvidence> = {}): GtfsCaseEvidence {
  return {
    departure: { reading: "not_recorded", at: null },
    started_at: null,
    started_late_minutes: null,
    started_inside_grace: null,
    vehicle: { reported_at: null, underway_at: null, vehicle_id: null },
    block: { block_id: "556", trips: 8, trips_reported: 7 },
    origin_stop: { stop_id: "S1", name: "Burnsville Center", other_cases: 6, other_cases_ran: 4, likely_dead_zone: false },
    ...overrides,
  };
}

describe("the case header, fixed route", () => {
  it("reads the Route 444 example: no start, but the block's bus was working", () => {
    const header = caseHeader(gtfs(evidence()), time);
    expect(header.scheduledLabel).toBe("Scheduled");
    expect(header.scheduled).toEqual(["Leave Burnsville Center 22:01 · Block 556", "30-minute deadline 22:31"]);
    expect(header.seen).toEqual([
      "No departure recorded in the Dispatch Log.",
      "No bus reported on this trip.",
      "Block 556's bus reported on 7 of its 8 trips.",
    ]);
    expect(header.looksLike).toEqual({
      text: "No start seen, but Block 556's bus was working. It may have run without reporting.",
      tone: "check",
      caution: "Check before confirming.",
    });
    expect(header.counting).toBe("The Suspected no-show detector is in Shadow detection: a confirmation is recorded, not charged.");
    expect(header.details.find((d) => d.label === "Flagged")?.value).toBe("22:35 (4 min after the deadline)");
    expect(header.details.find((d) => d.label === "Raised because")?.value).toBe("Suspected no-show: no start seen by the 30-minute deadline");
  });

  it("reads the Route 442 example: a late start, with the sign-in against the schedule", () => {
    const header = caseHeader(gtfs(evidence({
      departure: { reading: "schedule_repeated", at: "2026-11-01T13:02:00.000Z" },
      started_at: "2026-11-01T13:59:00.000Z",
      started_late_minutes: 57,
      started_inside_grace: false,
      vehicle: { reported_at: "2026-11-01T13:34:00.000Z", underway_at: "2026-11-01T13:59:00.000Z", vehicle_id: "4520" },
      block: { block_id: "515", trips: 7, trips_reported: 2 },
    }), { scheduledDepartureAt: "2026-11-01T13:02:00.000Z", graceDeadlineAt: "2026-11-01T13:32:00.000Z", evidenceFinding: "late_trip_start" }), time);
    expect(header.seen).toEqual(["Left the first stop 13:59 (57 min late)", "Bus 4520 signed in 13:34 (32 min after the scheduled start)."]);
    expect(header.looksLike).toEqual({ text: "Started 57 min late. Looks like a missed trip (late start).", tone: "missed" });
  });

  it("calls a start inside the 30 minutes timely service", () => {
    const header = caseHeader(gtfs(evidence({ started_at: "2026-10-31T22:20:00.000Z", started_late_minutes: 19, started_inside_grace: true })), time);
    expect(header.looksLike.tone).toBe("ran");
  });

  it("calls a block with no bus at all a block that did not run", () => {
    const header = caseHeader(gtfs(evidence({ block: { block_id: "556", trips: 8, trips_reported: 0 } })), time);
    expect(header.looksLike.tone).toBe("missed");
    expect(header.looksLike.text).toMatch(/block did not run/);
  });

  it("asks for a check when a signed-in bus went quiet at a likely dead zone", () => {
    const quiet = evidence({
      vehicle: { reported_at: "2026-10-31T21:50:00.000Z", underway_at: null, vehicle_id: "4521" },
      origin_stop: { stop_id: "S2", name: "Savage Park & Ride", other_cases: 52, other_cases_ran: 49, likely_dead_zone: true },
    });
    expect(caseHeader(gtfs(quiet), time).looksLike.tone).toBe("check");
    expect(caseHeader(gtfs({ ...quiet, origin_stop: { ...quiet.origin_stop!, likely_dead_zone: false } }), time).looksLike.tone).toBe("missed");
  });

  it("says when the evidence could not be read, rather than showing absence", () => {
    expect(caseHeader(gtfs(null), time, { evidenceUnavailable: true }).seen)
      .toEqual(["The start evidence could not be read just now. Reload before deciding."]);
    expect(caseHeader(gtfs(null), time).seen).toEqual(["Not seen past the first stop."]);
  });

  it("calls an advance cancellation what it is", () => {
    const header = caseHeader(gtfs(null, { detectionType: "explicit_cancellation", evidenceFinding: "advance_cancellation" }), time);
    expect(header.looksLike).toEqual({ text: "Cancelled by dispatch before it ran.", tone: "missed" });
    expect(header.counting).toMatch(/^The Advance cancellation detector is in Shadow detection/);
  });
});

describe("the case header, on demand", () => {
  // Dev request bfcba9fa on 2026-10-29: promised 16:00/16:14 Central, re-planned
  // to 16:28/17:16, served 16:25/17:15, and Spare reported the dropoff 1,903 s late.
  const times: SpareCaseTimes = {
    original_pickup_at: "2026-10-29T21:00:00.000Z",
    scheduled_pickup_at: "2026-10-29T21:28:58.000Z",
    pickup_arrived_at: "2026-10-29T21:25:57.000Z",
    original_dropoff_at: "2026-10-29T21:14:44.000Z",
    scheduled_dropoff_at: "2026-10-29T22:16:35.000Z",
    dropoff_arrived_at: "2026-10-29T22:15:56.000Z",
  };
  const spare = (overrides: Partial<HeaderInput> = {}): HeaderInput => gtfs(null, {
    sourceSystem: "spare",
    detectionType: "spare_late_arrival",
    evidenceFinding: "on_demand_service_failure",
    dataQualityStatus: "source_verified",
    detectorVersion: "spare-missed-v2",
    scheduledDepartureAt: times.scheduled_pickup_at,
    graceDeadlineAt: "2026-10-29T21:58:58.000Z",
    firstSeenWatchingAt: "2026-10-29T22:22:57.000Z",
    detectedLateArrivalAt: times.pickup_arrived_at,
    tripId: "spare:example-request",
    arrivalDelaySeconds: 1903,
    spareTimes: times,
    ...overrides,
  });

  it("shows the promised, re-planned and actual times the rule is about", () => {
    const header = caseHeader(spare(), time);
    expect(header.scheduledLabel).toBe("Booked");
    expect(header.scheduled).toEqual(["Pickup 21:00, moved to 21:28", "Dropoff 21:14, moved to 22:16"]);
    expect(header.seen).toEqual(["Picked up 21:25 · dropped off 22:15", "Spare reports the dropoff 32 min late."]);
    expect(header.looksLike.text).toBe("Late dropoff (30 min or more). Under the on-demand agreement this counts as a missed trip.");
    expect(header.details.find((d) => d.label === "Flagged")?.value)
      .toBe("22:22 (7 min after dropoff; on-demand rides are checked once they end)");
    expect(header.details.find((d) => d.label === "Data")?.value).toBe("From the source's own records");
  });

  it("warns when Spare's lateness matches neither time shown", () => {
    expect(caseHeader(spare(), time).looksLike.caution)
      .toBe("Spare's 32 min doesn't match the times above. Check the request in Spare.");
    // 31 minutes after the original dropoff would match.
    expect(caseHeader(spare({ arrivalDelaySeconds: 3672 }), time).looksLike.caution).toBeUndefined();
  });

  it("says nothing it cannot check when the times are absent", () => {
    const header = caseHeader(spare({ spareTimes: null }), time);
    expect(header.scheduled).toEqual(["Pickup 21:28"]);
    expect(header.seen[0]).toBe("Picked up 21:25 · dropoff arrival not recorded");
    expect(header.looksLike.caution).toBeUndefined();
  });
});

describe("what confirming charges", () => {
  const alert = (detectorPromoted: boolean | undefined) =>
    ({ sourceSystem: "gtfs", detectionType: "silent_no_show", serviceDate: "20261031", detectorPromoted }) as Pick<MissedTripAlert, "sourceSystem" | "detectionType" | "serviceDate" | "detectorPromoted">;

  it("states Shadow detection as a fact when the API says so", () => {
    expect(attributionHelp(alert(false), "contractor_error"))
      .toBe("This detector is in Shadow detection: confirming records the outcome, and nothing is charged.");
    expect(attributionHelp(alert(true), "contractor_error"))
      .toBe("Confirming adds this to the 10/2026 performance assessment as a charged occurrence.");
    expect(attributionHelp(alert(undefined), "excusable"))
      .toBe("Confirming records the occurrence against the month without charging a penalty, once its detector is out of Shadow detection.");
  });

  it("leaves the counting line out when the API does not say", () => {
    expect(countingLine(alert(undefined))).toBeNull();
    expect(countingLine(alert(true))).toBe("The Suspected no-show detector counts toward assessments: a confirmation is charged unless you attribute it otherwise.");
  });
});
