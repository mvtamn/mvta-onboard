import { describe, expect, it } from "vitest";
import type { MissedTripsMonthlySummaryRow } from "@mvta/shared";
import {
  AGING_HOURS, OVERDUE_HOURS, agingBadge, assessmentOutcome, buildReviewRequest, confirmBlockedReason,
  dataQualityLabel, detectionTypeLabel, formatServiceMonth, inView, lifecycleLabel, outcomeLabel,
  conflictNotice, pivotMonthlySummary, reviewMode, routeLabel, sourceLabel, tripCode,
} from "./missedTripReview.js";

const base = { tripId: "T1", serviceDate: "20260917", lifecycle: "ready_for_review" as const, validationStatus: "unreviewed" as const, heldReason: null };
const drafts = { reasonCode: "RAN", notes: "", attribution: "contractor_error" as const, changeReason: "" };

describe("missed-trip review requests", () => {
  it("a first review needs only a reason, and only a confirmation carries attribution", () => {
    const confirmed = buildReviewRequest(base, "confirmed", drafts);
    expect(confirmed).toEqual({ input: { trip_id: "T1", service_date: "20260917", validation_status: "confirmed", reason_code: "RAN", notes: undefined, attribution: "contractor_error" } });
    const timely = buildReviewRequest(base, "timely_service", drafts);
    expect("input" in timely && timely.input.attribution).toBe(undefined);
    expect(buildReviewRequest(base, "indeterminate", { ...drafts, reasonCode: "" })).toEqual({ error: "Select a reason before saving the review." });
  });

  it("changing a review sends supersede_reason; a legacy record sends rereview_reason", () => {
    const reviewed = { ...base, lifecycle: "reviewed" as const, validationStatus: "confirmed" as const };
    expect(reviewMode(reviewed)).toBe("supersede");
    expect(buildReviewRequest(reviewed, "timely_service", drafts)).toEqual({ error: "Say why the earlier review is being changed." });
    const superseding = buildReviewRequest(reviewed, "timely_service", { ...drafts, changeReason: " AVL shows it ran " });
    expect("input" in superseding && superseding.input.supersede_reason).toBe("AVL shows it ran");

    const legacy = { ...base, lifecycle: "legacy" as const };
    expect(reviewMode(legacy)).toBe("rereview");
    const rereview = buildReviewRequest(legacy, "indeterminate", { ...drafts, changeReason: "Rechecked" });
    expect("input" in rereview && rereview.input.rereview_reason).toBe("Rechecked");
  });

  it("confirmation waits for evidence; other outcomes do not", () => {
    const held = { ...base, lifecycle: "awaiting_evidence" as const, heldReason: "awaiting_confirmation" };
    expect(confirmBlockedReason(held)).toBe("Not ready to confirm: waiting for a second check to agree.");
    expect(buildReviewRequest(held, "confirmed", drafts)).toEqual({ error: "Not ready to confirm: waiting for a second check to agree." });
    expect("input" in buildReviewRequest(held, "indeterminate", drafts)).toBe(true);
  });

  it("labels and views follow the classification", () => {
    expect(outcomeLabel("false_positive")).toBe("Timely service");
    expect(lifecycleLabel({ lifecycle: "reviewed", validationStatus: "confirmed" })).toBe("Missed");
    expect(lifecycleLabel({ lifecycle: "reviewed", validationStatus: "partial_service_failure" })).toBe("Partial-service failure");
    expect(inView({ inQueue: true, concluded: false }, "queue")).toBe(true);
    expect(inView({ inQueue: false, concluded: true }, "queue")).toBe(false);
    expect(inView({ inQueue: false, concluded: true }, "history")).toBe(true);
  });
});

describe("pivotMonthlySummary", () => {
  const row = (overrides: Partial<MissedTripsMonthlySummaryRow> = {}): MissedTripsMonthlySummaryRow => ({
    service_month: "202608", route_id: "460", source_system: "gtfs",
    detection_type: "silent_no_show", detector: "gtfs_silent_no_show",
    lifecycle: "reviewed", evidence_finding: "suspected_no_show",
    review_outcome: "confirmed_missed_trip", counts_as_missed: true,
    counts_toward_assessment: false, trip_count: 1, ...overrides,
  });

  it("sums the buckets the server classified, not the stored status", () => {
    const [month] = pivotMonthlySummary([
      row({ trip_count: 3 }),
      row({ trip_count: 2, counts_toward_assessment: true }),
      row({ review_outcome: "timely_service", counts_as_missed: false, trip_count: 4 }),
      row({ review_outcome: "partial_service_failure", counts_as_missed: false, trip_count: 1 }),
      row({ review_outcome: "indeterminate", counts_as_missed: false, trip_count: 1 }),
      row({ lifecycle: "ready_for_review", review_outcome: null, counts_as_missed: false, trip_count: 5 }),
      row({ detector: "gtfs_cancellation", detection_type: "explicit_cancellation", trip_count: 2 }),
    ]);
    expect(month).toMatchObject({
      service_month: "202608", route_id: "460",
      cancellations: 2, noShows: 16, spareCandidates: 0,
      confirmedMissed: 7, countingTowardAssessment: 2,
      timelyService: 4, otherOutcome: 2, awaitingReview: 5, total: 18,
    });
  });

  it("keeps each month, route and source system apart, newest month first", () => {
    const rows = pivotMonthlySummary([
      row({ service_month: "202607" }),
      row({ route_id: "9" }),
      row({ route_id: "10" }),
      row({ source_system: "spare", detector: "spare", detection_type: "spare_late_start" }),
    ]);
    expect(rows.map((r) => [r.service_month, r.route_id, r.source_system])).toEqual([
      ["202608", "9", "gtfs"],
      ["202608", "10", "gtfs"],
      ["202608", "460", "spare"],
      ["202607", "460", "gtfs"],
    ]);
    expect(rows[2].spareCandidates).toBe(1);
  });
});

// The words the console puts on a case. These came out of MissedTripAlerts.tsx
// with this move; none of them had a test there, because reaching them meant
// rendering a 1253-line page.
describe("what the console calls a case", () => {
  it("names each detector, and says so honestly when the row predates detection tracking", () => {
    expect(detectionTypeLabel("explicit_cancellation")).toBe("Explicit cancellation (GTFS-RT)");
    expect(detectionTypeLabel("silent_no_show")).toBe("Scheduled no-show (never observed)");
    expect(detectionTypeLabel("spare_multiple")).toBe("Multiple Spare missed-trip conditions");
    // migration-023 added detection_type; older rows read back null.
    expect(detectionTypeLabel(null)).toBe("Unknown — flagged before detection tracking was added");
  });

  it("names the data-quality status, defaulting to legacy rather than guessing", () => {
    expect(dataQualityLabel("source_verified")).toBe("Source verified");
    expect(dataQualityLabel("experimental")).toBe("Experimental detector");
    expect(dataQualityLabel("legacy_unverified")).toBe("Legacy — unverified");
    expect(dataQualityLabel("unknown_data_gap")).toBe("Legacy — unverified");
  });

  it("names the source system", () => {
    expect(sourceLabel("spare")).toBe("Spare");
    expect(sourceLabel("gtfs")).toBe("GTFS-Realtime");
  });
});

describe("route labels", () => {
  const routes = new Map([
    ["420", { route_id: "420", route_short_name: "420", route_long_name: "Burnsville Express" }],
    ["460", { route_id: "460", route_short_name: "Red", route_long_name: "Red Line" }],
    ["999", { route_id: "999", route_short_name: "  ", route_long_name: "  " }],
  ] as const) as never as Map<string, import("@mvta/shared").GtfsRouteOption>;

  it("does not repeat the route number back at itself", () => {
    // route_short_name is the same string as route_id for MVTA's numbered
    // routes, so "Route 420 · 420" is what this rule exists to prevent.
    expect(routeLabel("420", routes)).toBe("Route 420 · Burnsville Express");
  });

  it("uses the short name when it adds something", () => {
    expect(routeLabel("460", routes)).toBe("Route 460 · Red");
  });

  it("falls back to the bare number when no name is usable", () => {
    expect(routeLabel("999", routes)).toBe("Route 999");
    expect(routeLabel("123", routes)).toBe("Route 123");
  });

  it("a Spare run is named by its service, not looked up as a route", () => {
    expect(routeLabel("MVTA Connect", routes, "spare")).toBe("Spare · MVTA Connect");
  });
});

describe("trip codes", () => {
  it("reads as time and direction, the way Avail's own reports name a trip", () => {
    expect(tripCode("2026-09-17T12:45:00", "SB")).toBe("1245-SB");
    expect(tripCode("2026-09-17T09:05:00", "NB")).toBe("0905-NB");
  });

  it("falls back to whichever half exists", () => {
    // direction_label is null whenever GtfsTripDirections has no row yet.
    expect(tripCode("2026-09-17T12:45:00", null)).toBe("1245");
    expect(tripCode(null, "SB")).toBe("SB");
    expect(tripCode(null, null)).toBe("—");
    expect(tripCode("not a date", null)).toBe("—");
  });
});

describe("review urgency", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const unreviewed = { validationStatus: "unreviewed" as const };

  it("is Aging after a day and Overdue after three", () => {
    expect(agingBadge({ ...unreviewed, firstSeenWatchingAt: hoursAgo(1) } as never)).toBe(null);
    expect(agingBadge({ ...unreviewed, firstSeenWatchingAt: hoursAgo(AGING_HOURS + 1) } as never)?.label).toBe("Aging");
    expect(agingBadge({ ...unreviewed, firstSeenWatchingAt: hoursAgo(OVERDUE_HOURS + 1) } as never)?.label).toBe("Overdue");
  });

  it("stops once someone has reviewed it, however old the row is", () => {
    // There is nothing left pending, so urgency is not the reviewer's problem.
    expect(agingBadge({ validationStatus: "confirmed", firstSeenWatchingAt: hoursAgo(500) } as never)).toBe(null);
  });

  it("says nothing when the timestamp cannot be read", () => {
    expect(agingBadge({ ...unreviewed, firstSeenWatchingAt: "not a date" } as never)).toBe(null);
  });
});

describe("where a decision went in the assessment", () => {
  const reviewed = {
    serviceDate: "20260917",
    validationStatus: "confirmed" as const,
    occurrenceServiceMonth: "202609",
    occurrenceReviewStatus: null as string | null,
    occurrenceAttribution: null as string | null,
    occurrencePeriodStatus: null as string | null,
  };

  it("says nothing until someone has reviewed it", () => {
    expect(assessmentOutcome({ ...reviewed, validationStatus: "unreviewed" } as never)).toBe(null);
  });

  it("a review that found no missed trip carries no charge", () => {
    for (const status of ["timely_service", "partial_service_failure", "indeterminate", "false_positive"]) {
      expect(assessmentOutcome({ ...reviewed, validationStatus: status } as never)?.tone).toBe("excluded");
    }
  });

  it("a confirmation with no occurrence says so, and why it might have none", () => {
    const outcome = assessmentOutcome(reviewed as never);
    expect(outcome?.label).toBe("Not linked");
    expect(outcome?.tone).toBe("pending");
    expect(outcome?.detail).toContain("09/2026");
  });

  it("a raised occurrence waits on attribution before it can be charged", () => {
    const outcome = assessmentOutcome({ ...reviewed, occurrenceReviewStatus: "candidate" } as never);
    expect(outcome?.label).toBe("Awaiting attribution");
    expect(outcome?.tone).toBe("pending");
  });

  it("an excusable or MVTA-directed occurrence is recorded but not charged", () => {
    const excusable = assessmentOutcome({ ...reviewed, occurrenceReviewStatus: "dismissed", occurrenceAttribution: "excusable" } as never);
    expect(excusable?.label).toBe("Recorded, not charged");
    expect(excusable?.detail).toContain("an excusable delay");
    const directed = assessmentOutcome({ ...reviewed, occurrenceReviewStatus: "dismissed", occurrenceAttribution: "mvta_directed" } as never);
    expect(directed?.detail).toContain("MVTA-directed");
  });

  it("a charged occurrence names its month, and whether that month is settled", () => {
    const open = assessmentOutcome({ ...reviewed, occurrenceReviewStatus: "assigned" } as never);
    expect(open?.label).toBe("Counted in 09/2026");
    expect(open?.detail).toContain("recomputes");
    const finalized = assessmentOutcome({ ...reviewed, occurrenceReviewStatus: "assigned", occurrencePeriodStatus: "finalized" } as never);
    expect(finalized?.detail).toContain("now finalized");
  });

  it("falls back to the service date's month when the occurrence names none", () => {
    const outcome = assessmentOutcome({ ...reviewed, occurrenceServiceMonth: null } as never);
    expect(outcome?.detail).toContain("09/2026");
  });
});

describe("service months", () => {
  it("reads as MM/YYYY, and passes anything else through untouched", () => {
    expect(formatServiceMonth("202609")).toBe("09/2026");
    expect(formatServiceMonth("2026-09")).toBe("2026-09");
    expect(formatServiceMonth("")).toBe("");
  });
});

describe("sources that disagree", () => {
  const conflicted = {
    evidenceConflict: true,
    evidenceConflictReason: "Avail reports this run as missed; the case concluded Timely service.",
    validationStatus: "unreviewed" as const,
  };

  it("says nothing when the sources agree", () => {
    expect(conflictNotice({ ...conflicted, evidenceConflict: false })).toBe(null);
  });

  it("repeats what the server said disagreed", () => {
    const notice = conflictNotice(conflicted);
    expect(notice?.label).toBe("Sources disagree");
    expect(notice?.detail).toContain("Avail reports this run as missed");
  });

  it("still explains itself when the server recorded no reason", () => {
    for (const reason of [null, "", "   "]) {
      const notice = conflictNotice({ ...conflicted, evidenceConflictReason: reason });
      expect(notice?.detail).toBe("Two sources disagree about whether this run operated.");
    }
  });

  it("asks an unreviewed case for a review, and a reviewed one for a change", () => {
    expect(conflictNotice(conflicted)?.action).toContain("Review it with both sources");
    const reviewed = conflictNotice({ ...conflicted, validationStatus: "confirmed" });
    expect(reviewed?.action).toContain("Change the review");
  });

  it("always says the assessment is what is held", () => {
    for (const status of ["unreviewed", "confirmed", "timely_service"] as const) {
      expect(conflictNotice({ ...conflicted, validationStatus: status })?.action)
        .toContain("performance assessment");
    }
  });
});

describe("the assessment line under a conflict", () => {
  const confirmed = {
    serviceDate: "20260917",
    validationStatus: "confirmed" as const,
    occurrenceServiceMonth: "202609",
    occurrenceReviewStatus: "assigned",
    occurrenceAttribution: null,
    occurrencePeriodStatus: null,
    evidenceConflict: false,
    evidenceConflictReason: null,
  };

  it("does not claim a conflicted case is counted", () => {
    // The server's Assessment evidence gate holds it out whatever the review
    // said, so "Counted in 09/2026" would be untrue of the server.
    expect(assessmentOutcome(confirmed as never)?.label).toBe("Counted in 09/2026");
    const held = assessmentOutcome({ ...confirmed, evidenceConflict: true } as never);
    expect(held?.label).toBe("Held — sources disagree");
    expect(held?.tone).toBe("pending");
  });

  it("holds a conflicted case out whatever the review said", () => {
    for (const status of ["confirmed", "timely_service", "indeterminate"] as const) {
      const held = assessmentOutcome({ ...confirmed, validationStatus: status, evidenceConflict: true } as never);
      expect(held?.label).toBe("Held — sources disagree");
    }
  });
});
