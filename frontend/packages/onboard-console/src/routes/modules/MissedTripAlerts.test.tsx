import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissedTrip, MissedTripsDiagnostics } from "@mvta/shared";
import { api } from "../../config.js";
import { agoLabel, MissedTripAlerts } from "./MissedTripAlerts.js";

vi.mock("../../config.js", () => ({
  api: {
    getRoutes: vi.fn().mockResolvedValue({ routes: [] }),
    getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [] }),
    getMissedTrips: vi.fn(),
    getMissedTripReviews: vi.fn().mockResolvedValue({ reviews: [] }),
    validateMissedTrip: vi.fn(),
    // The module renders KpiTrustSummary, which reads this.
    getKpiTrust: vi.fn().mockResolvedValue({ checked_at: "2026-08-24T00:00:00Z", streams: {} }),
  },
}));

const diagnostics: MissedTripsDiagnostics = {
  configured: true, view: "queue", limit: 200, offset: 0, returned_count: 2,
  view_count: 2, total_count: 2, active_count: 2, resolved_count: 0,
  unreviewed_count: 2, confirmed_count: 0, false_positive_count: 0, routes_affected_count: 2,
  legacy_unverified_count: 0, last_checked_at: null,
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

    // The Spare candidate count now rides on the data line rather than holding
    // a banner of its own, so it is matched as a substring of that line.
    expect(await screen.findByText(/1 Spare candidate in this view\./)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by data source"), "spare");

    expect(screen.getByText("Spare · MVTA Connect")).toBeInTheDocument();
    expect(screen.queryByText("Route 400")).not.toBeInTheDocument();
  });
});

function feed(
  feed_name: string,
  required: boolean,
  status: "current" | "stale" | "unavailable",
  stale_after_minutes: number | null,
) {
  return {
    feed_name, required, status, stale_after_minutes,
    last_success_at: "2026-09-03T08:02:00.000Z",
    last_entity_count: 0,
    source_timestamp_at: null,
  };
}

describe("Missed Trips legacy exclusion", () => {
  it("reports how many legacy candidates the queue leaves out", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: { ...diagnostics, legacy_unverified_count: 3518 },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/3,518 legacy candidates/)).toBeInTheDocument();
  });

  it("says nothing when no legacy candidates exist", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: { ...diagnostics, legacy_unverified_count: 0 },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/Spare candidate/)).toBeInTheDocument();
    expect(screen.queryByText(/legacy candidates/)).not.toBeInTheDocument();
  });
});

describe("Missed Trips feed warning", () => {
  it("warns only about required feeds, naming each feed's own contract", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: {
        ...diagnostics,
        feed_health: [
          feed("gtfs_trip_updates", true, "current", 15),
          feed("spare_requests", true, "stale", 45),
          // Supporting and beyond nothing it has agreed to - a daily
          // retrospective feed must not tell staff to distrust the queue.
          feed("avail_missed_trips", false, "current", null),
        ],
      },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/spare_requests \(beyond its 45-minute contract\)/)).toBeInTheDocument();
    expect(screen.queryByText(/avail_missed_trips/)).not.toBeInTheDocument();
    expect(screen.queryByText(/within 15 minutes/)).not.toBeInTheDocument();
  });

  it("stays silent when every required feed is current", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: {
        ...diagnostics,
        feed_health: [
          feed("gtfs_trip_updates", true, "current", 15),
          feed("gtfs_vehicle_positions", true, "current", 15),
          feed("avail_missed_trips", false, "current", null),
        ],
      },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/Spare candidate/)).toBeInTheDocument();
    expect(screen.queryByText("Feed warning")).not.toBeInTheDocument();
  });
});

describe("agoLabel", () => {
  it("keeps minutes below an hour", () => {
    expect(agoLabel(0)).toBe("0 min ago");
    expect(agoLabel(59)).toBe("59 min ago");
  });

  it("switches to hours and minutes past an hour", () => {
    expect(agoLabel(60)).toBe("1h ago");
    expect(agoLabel(250)).toBe("4h 10m ago");
  });

  it("rolls over to days at 24 hours instead of counting hours forever", () => {
    // The reported defect: capping minutes at 60 while letting hours run free
    // only moved the unbounded count up a tier, so an overnight row read
    // "26h 14m ago" and a weekend one "73h 5m ago".
    expect(agoLabel(24 * 60)).toBe("1d ago");
    expect(agoLabel(26 * 60 + 14)).toBe("1d 2h ago");
    expect(agoLabel(73 * 60 + 5)).toBe("3d 1h ago");
  });

  it("drops the hour part on a whole number of days", () => {
    expect(agoLabel(48 * 60)).toBe("2d ago");
  });

  it("renders an em dash when there is no timestamp", () => {
    expect(agoLabel(null)).toBe("—");
  });
});
