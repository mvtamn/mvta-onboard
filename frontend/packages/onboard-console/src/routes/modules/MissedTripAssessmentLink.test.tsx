import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissedTrip, MissedTripsDiagnostics } from "@mvta/shared";
import { api } from "../../config.js";
import { AccessContext, accessStateWith } from "../../auth/AccessContext.js";
import { MissedTripAlerts } from "./MissedTripAlerts.js";

vi.mock("../../config.js", () => ({
  api: {
    getRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [{ code: "OPERATOR", label: "Operator unavailable" }] }),
    getMissedTrips: vi.fn(),
    getMissedTripReviews: vi.fn().mockResolvedValue({ reviews: [] }),
    validateMissedTrip: vi.fn(),
    attributeComplianceOccurrence: vi.fn().mockResolvedValue({ id: "occ-1", attribution: "contractor_error" }),
  },
}));

const diagnostics: MissedTripsDiagnostics = {
  configured: true, view: "all", limit: 200, offset: 0, returned_count: 1,
  view_count: 1, total_count: 1, active_count: 1, resolved_count: 0,
  unreviewed_count: 1, confirmed_count: 0, false_positive_count: 0, routes_affected_count: 1,
  legacy_unverified_count: 0, unknown_data_gap_count: 0,
  pending_confirmation_count: 0, held_undecided_count: 0, last_checked_at: null,
  silent_no_show_enabled: true, schedule_detection_status: "experimental",
  spare_enabled: false, spare_service_scope_configured: false, feed_health: [],
};

function trip(overrides: Partial<MissedTrip> = {}): MissedTrip {
  return {
    trip_id: "trip-1", service_date: "20260825", route_id: "400",
    scheduled_departure_at: "2026-08-25T14:00:00Z", grace_deadline_at: "2026-08-25T14:30:00Z",
    status: "watching", detection_type: "silent_no_show", detected_late_arrival_at: null,
    suggested_alert_id: null, first_seen_watching_at: "2026-08-25T14:30:00Z",
    last_checked_at: "2026-08-25T14:30:00Z", validation_status: "unreviewed", reason_code: null,
    validated_by: null, validated_at: null, notes: null, detector_version: "test",
    data_quality_status: "source_verified", undecided_reason: null, source_system: "gtfs", source_record_id: null,
    condition_late_start: null, condition_superseded: null, condition_late_arrival: null,
    start_delay_seconds: null, arrival_delay_seconds: null, direction_label: null,
    occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,
    lifecycle: "ready_for_review", evidence_finding: "suspected_no_show", review_outcome: null,
    held_reason: null, in_queue: true, concluded: false,
    ...overrides,
  } as MissedTrip;
}

const view = (actions: string[] = []) => render(
  <AccessContext.Provider value={accessStateWith(actions)}>
    <MemoryRouter><MissedTripAlerts /></MemoryRouter>
  </AccessContext.Provider>,
);

describe("confirming a missed trip lands it in the month's assessment", () => {
  beforeEach(() => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({ missed_trips: [trip()], diagnostics });
    vi.mocked(api.validateMissedTrip).mockResolvedValue({
      trip_id: "trip-1", service_date: "20260825", validation_status: "confirmed", reason_code: "OPERATOR",
      assessment: { linked: true, occurrence_id: "occ-1", service_month: "202608", review_status: "confirmed", standard_code: "MISSED_TRIPS_FR" },
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  // Plan step 0.8 (MVTA, 2026-11-06): a specialist reviews, managers decide
  // attribution, the COO decides excusable.
  it("the review records the outcome only, and says a manager attributes it", async () => {
    const user = userEvent.setup();
    view(["compliance-review.view", "compliance-review.review"]);
    await user.selectOptions(await screen.findByLabelText("Reason"), "OPERATOR");
    expect(screen.queryByLabelText("Attribution")).not.toBeInTheDocument();
    expect(screen.getByText(/as awaiting attribution.*A manager then records whose error it was/)).toBeInTheDocument();
    await user.click(screen.getByText("Confirmed missed trip"));
    expect(api.validateMissedTrip).toHaveBeenCalledWith(expect.objectContaining({ trip_id: "trip-1", validation_status: "confirmed" }));
    expect(vi.mocked(api.validateMissedTrip).mock.calls[0][0]).not.toHaveProperty("attribution");
  });

  it("reports it when the review saved but the assessment could not take it", async () => {
    // The review is a fact about service and commits regardless. Saying so
    // here is the difference between a known gap and a silent one.
    vi.mocked(api.validateMissedTrip).mockResolvedValue({
      trip_id: "trip-1", service_date: "20260825", validation_status: "confirmed", reason_code: "OPERATOR",
      assessment: { linked: false, reason: "no_agreement", explanation: "The review was saved, but no active Performance Agreement covers this contractor." },
    });
    const user = userEvent.setup();
    view();
    await user.selectOptions(await screen.findByLabelText("Reason"), "OPERATOR");
    await user.click(screen.getByText("Confirmed missed trip"));
    expect(await screen.findByText(/no active Performance Agreement covers this contractor/)).toBeInTheDocument();
  });

  it("shows a reviewed trip where its decision ended up", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [trip({
        validation_status: "confirmed", validated_by: "A reviewer", reason_code: "OPERATOR",
        lifecycle: "reviewed", review_outcome: "confirmed_missed_trip", in_queue: false, concluded: true,
        occurrence_review_status: "confirmed",
        occurrence_attribution: "contractor_error", occurrence_service_month: "202608",
        occurrence_period_status: "in_review",
      })],
      diagnostics: { ...diagnostics, unreviewed_count: 0, confirmed_count: 1 },
    });
    const user = userEvent.setup();
    view();
    // A reviewed trip has left the queue; History is where it now lives.
    await user.click(await screen.findByText("History"));
    expect(await screen.findByText("Counted in 08/2026")).toBeInTheDocument();
    expect(screen.getByText("Open Performance Assessment")).toBeInTheDocument();
  });

  it("says plainly when a confirmed trip produced no occurrence at all", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [trip({ validation_status: "confirmed", validated_by: "A reviewer", reason_code: "OPERATOR", lifecycle: "reviewed", review_outcome: "confirmed_missed_trip", in_queue: false, concluded: true })],
      diagnostics: { ...diagnostics, unreviewed_count: 0, confirmed_count: 1 },
    });
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByText("History"));
    expect(await screen.findByText("Not linked")).toBeInTheDocument();
  });

  const awaiting = () => trip({
    validation_status: "confirmed", validated_by: "specialist@example.com", reason_code: "OPERATOR",
    lifecycle: "reviewed", review_outcome: "confirmed_missed_trip", in_queue: false, concluded: true,
    occurrence_id: "occ-1", occurrence_review_status: "candidate", occurrence_attribution: "undetermined",
    occurrence_service_month: "202608", occurrence_period_status: "in_review",
  });

  it("a manager attributes a confirmed case on its occurrence, and is not offered excusable", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({ missed_trips: [awaiting()], diagnostics: { ...diagnostics, unreviewed_count: 0, confirmed_count: 1 } });
    const user = userEvent.setup();
    view(["compliance-review.view", "compliance-review.review", "compliance-review.attribute"]);
    await user.click(await screen.findByText("History"));
    expect(await screen.findByText("Awaiting a manager's attribution.")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Attribution" });
    expect(screen.queryByRole("button", { name: "Excusable" })).not.toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Contractor error" }));
    expect(api.attributeComplianceOccurrence).toHaveBeenCalledWith("occ-1", "contractor_error");
  });

  it("a reviewer sees who decided the attribution, and is offered nothing", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [trip({
        ...awaiting(), occurrence_review_status: "dismissed", occurrence_attribution: "excusable",
        occurrence_attributed_by: "coo@example.com", occurrence_attributed_at: null,
      } as Partial<MissedTrip>)],
      diagnostics: { ...diagnostics, unreviewed_count: 0, confirmed_count: 1 },
    });
    const user = userEvent.setup();
    view(["compliance-review.view", "compliance-review.review"]);
    await user.click(await screen.findByText("History"));
    expect(await screen.findByText("Excusable, decided by coo@example.com.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Attribution" })).not.toBeInTheDocument();
  });
});
