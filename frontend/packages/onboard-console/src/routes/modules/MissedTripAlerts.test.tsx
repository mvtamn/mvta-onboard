import { cleanup, render, screen, within } from "@testing-library/react";
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
  },
}));

const diagnostics: MissedTripsDiagnostics = {
  configured: true, view: "queue", limit: 200, offset: 0, returned_count: 2,
  view_count: 2, total_count: 2, active_count: 2, resolved_count: 0,
  unreviewed_count: 2, confirmed_count: 0, false_positive_count: 0, routes_affected_count: 2,
  legacy_unverified_count: 0, unknown_data_gap_count: 0,
  pending_confirmation_count: 0, held_undecided_count: 0, last_checked_at: null,
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
    data_quality_status: "source_verified", undecided_reason: null, source_system, source_record_id: `${source_system}-record`,
    condition_late_start: source_system === "spare", condition_superseded: false,
    condition_late_arrival: false, start_delay_seconds: null, arrival_delay_seconds: null, direction_label: null,
    occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,
    lifecycle: "ready_for_review", evidence_finding: source_system === "spare" ? "on_demand_service_failure" : "suspected_no_show",
    review_outcome: null, held_reason: null, in_queue: true, concluded: false,
    evidence_conflict: false, evidence_conflict_reason: null,
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

describe("Missed Trips held candidates", () => {
  it("says how many candidates are waiting for a second poll to agree", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: { ...diagnostics, pending_confirmation_count: 12 },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/12 candidates are waiting for a second poll/)).toBeInTheDocument();
  });

  it("says how many are held because something other than the trip explains the silence", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: { ...diagnostics, held_undecided_count: 47 },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/47 more are held/)).toBeInTheDocument();
  });

  it("counts one candidate in the singular", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics: { ...diagnostics, pending_confirmation_count: 1 },
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/1 candidate is waiting/)).toBeInTheDocument();
  });

  // A quiet queue because detection is being careful must not be silent about
  // it - but a genuinely clear one should say nothing extra.
  it("says nothing when nothing is held", async () => {
    vi.mocked(api.getMissedTrips).mockResolvedValue({
      missed_trips: [candidate("gtfs", "400")],
      diagnostics,
    });

    render(<MissedTripAlerts />);

    expect(await screen.findByText(/Spare candidate/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for a second poll/)).not.toBeInTheDocument();
    expect(screen.queryByText(/are held/)).not.toBeInTheDocument();
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

describe("Missed Trips review outcomes", () => {
  it("offers the four outcomes and sends the one chosen", async () => {
    vi.mocked(api.getReasonCodes).mockResolvedValue({ reason_codes: [{ code: "RAN", label: "Ran per AVL" }] } as never);
    vi.mocked(api.getMissedTrips).mockResolvedValue({ missed_trips: [candidate("gtfs", "460")], diagnostics });
    vi.mocked(api.validateMissedTrip).mockResolvedValue({ trip_id: "gtfs-trip", service_date: "20260825", validation_status: "partial_service_failure", reason_code: "RAN", assessment: { linked: false, reason: "shadow_detection", explanation: "Shadow" } });
    render(<MissedTripAlerts />);
    const group = await screen.findByRole("group", { name: "Review outcome" });
    for (const label of ["Confirmed missed trip", "Timely service", "Partial-service failure", "Indeterminate"]) {
      expect(within(group).getByRole("button", { name: label })).toBeTruthy();
    }
    await userEvent.selectOptions(await screen.findByLabelText("Reason"), "RAN");
    await userEvent.click(within(group).getByRole("button", { name: "Partial-service failure" }));
    expect(api.validateMissedTrip).toHaveBeenCalledWith(expect.objectContaining({ validation_status: "partial_service_failure", reason_code: "RAN", attribution: undefined }));
    expect(vi.mocked(api.validateMissedTrip).mock.calls[0][0]).not.toHaveProperty("supersede_reason");
  });

  it("holds confirmation while a case is awaiting evidence, and says why", async () => {
    vi.mocked(api.getReasonCodes).mockResolvedValue({ reason_codes: [{ code: "RAN", label: "Ran per AVL" }] } as never);
    const held = { ...candidate("gtfs", "460"), lifecycle: "awaiting_evidence" as const, held_reason: "awaiting_operating_window", in_queue: true };
    vi.mocked(api.getMissedTrips).mockResolvedValue({ missed_trips: [held], diagnostics });
    render(<MissedTripAlerts />);
    await userEvent.selectOptions(await screen.findByLabelText("Reason"), "RAN");
    const group = await screen.findByRole("group", { name: "Review outcome" });
    expect((within(group).getByRole("button", { name: "Confirmed missed trip" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(group).getByRole("button", { name: "Indeterminate" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Not ready to confirm: waiting for the trip's scheduled run to end/)).toBeTruthy();
  });
});
