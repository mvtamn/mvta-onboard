import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type TripStartLogResponse, type TripStartLogTrip } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../config.js";
import { TripStartLog } from "./TripStartLog.js";

vi.mock("../../../config.js", () => ({
  api: { getTripStartLog: vi.fn() },
}));
vi.mock("../../../context/FixedRouteRefreshContext.js", () => ({
  useFixedRouteRefresh: () => ({ lastCompletedAt: null, secondsLeft: 30, intervalMs: 30_000 }),
  formatRefreshCountdown: (s: number) => `${s}s`,
}));

function trip(overrides: Partial<TripStartLogTrip> & { trip_id: string }): TripStartLogTrip {
  return {
    service_date: "20260908",
    block_id: "1",
    route_id: "444-2-A",
    route_short_name: "444",
    direction_id: 0,
    direction_label: "EB",
    origin_stop_id: "1",
    origin_stop_name: "Apple Valley Transit Station",
    scheduled_start_seconds: 3 * 3600 + 20 * 60,
    scheduled_start_at: "2026-09-08T08:20:00Z",
    in_rotation: false,
    rotation_day: "monday",
    actual_start_at: null,
    actual_start_source: null,
    start_delay_seconds: null,
    start_status: "unknown",
    verification: null,
    ...overrides,
  };
}

function response(trips: TripStartLogTrip[], overrides: Partial<TripStartLogResponse["diagnostics"]> = {}): TripStartLogResponse {
  return {
    service_date: "20260908",
    trips,
    diagnostics: {
      table_ready: true,
      materialized: trips.length > 0,
      trip_count: trips.length,
      rotation_count: trips.filter((t) => t.in_rotation).length,
      rotation_anchor_date: "20260908",
      week_offset: 0,
      ...overrides,
    },
  };
}

const DAY = [
  trip({ trip_id: "t1", in_rotation: true, rotation_day: "tuesday" }),
  trip({ trip_id: "t2", block_id: "2", route_short_name: "460", scheduled_start_seconds: 5 * 3600, start_status: "late", start_delay_seconds: 120, in_rotation: true, rotation_day: "tuesday", verification: { observation: "observed_left_late", verified_by: "ocs@example.org", verified_initials: "JD", verified_at: "2026-09-08T10:03:00Z", note: null } }),
  trip({ trip_id: "t3", block_id: "3", route_short_name: "Orange LINK", route_id: "425", scheduled_start_seconds: 6 * 3600, start_status: "on_time", start_delay_seconds: -20, rotation_day: "wednesday" }),
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function stat(label: string): string {
  const strip = screen.getByLabelText("Dispatch log summary");
  return within(strip).getByText(label).closest(".tsl-stat")?.querySelector("strong")?.textContent ?? "";
}

describe("Dispatch Log shell", () => {
  it("lists the day's trips with the rotation marked and the summary over them", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    render(<TripStartLog />);

    const table = await screen.findByRole("table", { name: "Dispatch log trips" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Needs initials");
    expect(rows[0]).toHaveTextContent("03:20");
    expect(rows[1]).toHaveTextContent("JD");
    expect(rows[2]).toHaveClass("dim");
    expect(stat("On time")).toBe("1");
    expect(stat("Left late ≤5")).toBe("1");
    expect(stat("No actual")).toBe("1");
    expect(stat("Start OTP")).toBe("100%");
    expect(stat("Awaiting initials")).toBe("1");
  });

  it("carries a selection from the rows into the inspector", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    render(<TripStartLog />);
    const user = userEvent.setup();

    expect(await screen.findByText(/Select a trip to see/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Dispatch log trips" });
    await user.click(within(table).getByText("Orange LINK"));

    const inspector = screen.getByRole("complementary", { name: "Trip details" });
    expect(inspector).toHaveTextContent("Route Orange LINK · block 3 · 06:00");
    expect(inspector).toHaveTextContent("Wed");
    expect(inspector).toHaveTextContent("Not on today's list");
    expect(within(inspector).getByRole("button", { name: "Observed on time" })).toBeDisabled();

    // Switching view keeps the selection - it belongs to the module, not the view.
    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByRole("tabpanel", { name: "Timeline view" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Trip details" })).toHaveTextContent("Orange LINK");
  });

  it("narrows every view to today's rotation and offers Clear only while a filter is set", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    render(<TripStartLog />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Dispatch log trips" });
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today's rotation" }));

    const table = screen.getByRole("table", { name: "Dispatch log trips" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(2);
    expect(stat("Awaiting initials")).toBe("1");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Start status"), "on_time");
    expect(screen.getByText("No trips match")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(screen.getByRole("table", { name: "Dispatch log trips" })).getAllByRole("row").slice(1)).toHaveLength(3);
  });

  it("does not report a zeroed day when the log's tables are missing", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response([], { table_ready: false, materialized: false }));
    render(<TripStartLog />);

    expect(await screen.findByText("Dispatch Log is not connected")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Apply migration 094");
    expect(stat("On time")).toBe("—");
    expect(stat("Awaiting initials")).toBe("—");
  });

  it("says when a date simply has no log yet", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response([]));
    render(<TripStartLog />);

    expect(await screen.findByText("No log for this date")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("09:30 UTC");
  });

  it("re-reads the log for a newly chosen service date", async () => {
    vi.mocked(api.getTripStartLog)
      .mockResolvedValueOnce(response(DAY))
      .mockResolvedValueOnce({ ...response([]), service_date: "20260909" });
    render(<TripStartLog />);

    await screen.findByRole("table", { name: "Dispatch log trips" });
    const input = screen.getByLabelText("Service date") as HTMLInputElement;
    expect(input.value).toBe("2026-09-08");
    fireEvent.change(input, { target: { value: "2026-09-09" } });

    expect(await screen.findByText("No log for this date")).toBeInTheDocument();
    expect(api.getTripStartLog).toHaveBeenLastCalledWith("20260909");
  });

  it("names a failed request as unavailable rather than blaming the data", async () => {
    vi.mocked(api.getTripStartLog).mockRejectedValueOnce(new ApiError(503, "upstream down"));
    render(<TripStartLog />);

    expect(await screen.findByText("Dispatch Log unavailable")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("upstream down");
  });
});
