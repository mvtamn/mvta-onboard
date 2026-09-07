import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissedTrip, MissedTripsDiagnostics } from "@mvta/shared";
import { api } from "../../config.js";
import { MissedTripAlerts } from "./MissedTripAlerts.js";

vi.mock("../../config.js", () => ({
  api: {
    getRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [{ code: "OPERATOR", label: "Operator unavailable" }] }),
    getMissedTrips: vi.fn(),
    getMissedTripReviews: vi.fn().mockResolvedValue({ reviews: [] }),
    validateMissedTrip: vi.fn(),
  },
}));

const diagnostics: MissedTripsDiagnostics = {
  configured: true, view: "all", limit: 200, offset: 0, returned_count: 1,
  view_count: 1, total_count: 1, active_count: 1, resolved_count: 0,
  unreviewed_count: 1, confirmed_count: 0, false_positive_count: 0, routes_affected_count: 1,
  legacy_unverified_count: 0, last_checked_at: null,
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
    data_quality_status: "source_verified", source_system: "gtfs", source_record_id: null,
    condition_late_start: null, condition_superseded: null, condition_late_arrival: null,
    start_delay_seconds: null, arrival_delay_seconds: null, direction_label: null,
    occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,
    ...overrides,
  } as MissedTrip;
}

const view = () => render(<MemoryRouter><MissedTripAlerts /></MemoryRouter>);

describe("confirming a missed trip lands it in the month's assessment", () => {
  beforeEach(() => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({ missed_trips: [trip()], diagnostics });
    vi.mocked(api.validateMissedTrip).mockResolvedValue({
      trip_id: "trip-1", service_date: "20260825", validation_status: "confirmed", reason_code: "OPERATOR",
      assessment: { linked: true, occurrence_id: "occ-1", service_month: "202608", review_status: "confirmed", standard_code: "MISSED_TRIPS_FR" },
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("asks whose error it was at the same sitting as the review", async () => {
    const user = userEvent.setup();
    view();
    await screen.findByLabelText("Attribution");
    // Charging the contractor is the default because a confirmed missed trip
    // is the contractor's obligation unless someone says otherwise.
    expect(screen.getByLabelText("Attribution")).toHaveValue("contractor_error");
    expect(screen.getByText(/adds this to the 08\/2026 performance assessment/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Attribution"), "excusable");
    expect(screen.getByText(/records the occurrence against the month without charging/)).toBeInTheDocument();
  });

  it("sends the attribution with the review, so one action settles both", async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(await screen.findByLabelText("Reason"), "OPERATOR");
    await user.selectOptions(screen.getByLabelText("Attribution"), "mvta_directed");
    await user.click(screen.getByText("Confirm missed trip"));
    expect(api.validateMissedTrip).toHaveBeenCalledWith(expect.objectContaining({
      trip_id: "trip-1", validation_status: "confirmed", attribution: "mvta_directed",
    }));
  });

  it("never attributes a false positive - there is no occurrence to attribute", async () => {
    const user = userEvent.setup();
    view();
    await user.selectOptions(await screen.findByLabelText("Reason"), "OPERATOR");
    await user.click(screen.getByText("Mark false positive"));
    expect(api.validateMissedTrip).toHaveBeenCalledWith(expect.objectContaining({
      validation_status: "false_positive", attribution: undefined,
    }));
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
    await user.click(screen.getByText("Confirm missed trip"));
    expect(await screen.findByText(/no active Performance Agreement covers this contractor/)).toBeInTheDocument();
  });

  it("shows a reviewed trip where its decision ended up", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [trip({
        validation_status: "confirmed", validated_by: "A reviewer", reason_code: "OPERATOR",
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
      missed_trips: [trip({ validation_status: "confirmed", validated_by: "A reviewer", reason_code: "OPERATOR" })],
      diagnostics: { ...diagnostics, unreviewed_count: 0, confirmed_count: 1 },
    });
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByText("History"));
    expect(await screen.findByText("Not linked")).toBeInTheDocument();
  });
});
