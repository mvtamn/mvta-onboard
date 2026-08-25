import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissedTrip, MissedTripsDiagnostics } from "@mvta/shared";
import { api } from "../../config.js";
import { MissedTripAlerts } from "./MissedTripAlerts.js";

vi.mock("../../config.js", () => ({
  api: {
    getRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [] }),
    getMissedTrips: vi.fn(),
    getMissedTripReviews: vi.fn().mockResolvedValue({ reviews: [] }),
    validateMissedTrip: vi.fn(),
  },
}));

const diagnostics: MissedTripsDiagnostics = {
  configured: true, view: "queue", limit: 200, offset: 0, returned_count: 2,
  view_count: 2, total_count: 2, active_count: 2, resolved_count: 0,
  unreviewed_count: 2, legacy_unverified_count: 0, last_checked_at: null,
  silent_no_show_enabled: true, schedule_detection_status: "experimental",
  spare_enabled: true, spare_service_scope_configured: true, feed_health: [],
};

function candidate(source_system: "spare" | "gtfs", route_id: string): MissedTrip {
  return {
    trip_id: `${source_system}-trip`, service_date: "20260825", route_id,
    scheduled_departure_at: "2026-08-25T14:00:00Z", grace_deadline_at: "2026-08-25T14:30:00Z",
    status: "watching", detection_type: source_system === "spare" ? "spare_late_start" : "silent_no_show",
    detected_late_arrival_at: null, suggested_alert_id: null, first_seen_watching_at: "2026-08-25T14:30:00Z",
    last_checked_at: "2026-08-25T14:30:00Z", validation_status: "unreviewed", reason_code: null,
    validated_by: null, validated_at: null, notes: null, detector_version: "test",
    data_quality_status: "source_verified", source_system, source_record_id: `${source_system}-record`,
    condition_late_start: source_system === "spare", condition_superseded: false,
    condition_late_arrival: false, start_delay_seconds: null, arrival_delay_seconds: null, direction_label: null,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Missed Trips Spare source visibility", () => {
  it("shows Spare feed status and isolates Spare candidates", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("spare", "MVTA Connect"), candidate("gtfs", "400")],
      diagnostics,
    });
    const user = userEvent.setup();

    render(<MissedTripAlerts />);

    expect(await screen.findByText("Spare feed enabled")).toBeInTheDocument();
    expect(screen.getByText("1 Spare candidate in this view.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by data source"), "spare");

    expect(screen.getByText("Spare · MVTA Connect")).toBeInTheDocument();
    expect(screen.queryByText("Route 400")).not.toBeInTheDocument();
  });
});
