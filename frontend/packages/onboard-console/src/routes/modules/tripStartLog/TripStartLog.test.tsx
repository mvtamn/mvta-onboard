import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError, type TripStartLogResponse, type TripStartLogTrip } from "@mvta/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../config.js";
import { TripStartLog } from "./TripStartLog.js";

vi.mock("../../../config.js", () => ({
  api: { getTripStartLog: vi.fn(), getTripStartLogCsv: vi.fn() },
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
    predicted_start_at: null,
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

  it("sorts the grid from its headers and keeps the order when the view changes", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    render(<TripStartLog />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "Dispatch log trips" });
    expect(within(table).getByRole("columnheader", { name: /Scheduled/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(table).getByRole("button", { name: "Route" }));
    let rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[6]?.textContent)).toEqual(["444", "460", "Orange LINK"]);
    await user.click(within(table).getByRole("button", { name: "Route" }));
    rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Orange LINK");

    // The order belongs to the shell: leaving and returning to the Grid keeps it.
    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByRole("figure", { name: "Trip starts by block" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Grid" }));
    const again = screen.getByRole("table", { name: "Dispatch log trips" });
    expect(within(again).getAllByRole("row").slice(1)[0]).toHaveTextContent("Orange LINK");
    expect(within(again).getByRole("columnheader", { name: /Route/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("shows the Watch and Timeline views over the same filtered rows and selection", async () => {
    const lateOverFive = trip({
      trip_id: "t4", block_id: "4", route_short_name: "477", scheduled_start_seconds: 6 * 3600 + 30 * 60,
      scheduled_start_at: "2026-09-08T11:30:00Z", actual_start_at: "2026-09-08T11:42:00Z", actual_start_source: "vehicle_position",
      start_status: "late", start_delay_seconds: 720, in_rotation: true, rotation_day: "tuesday",
    });
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response([...DAY, lateOverFive]));
    render(<TripStartLog />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Dispatch log trips" });
    await user.click(screen.getByRole("tab", { name: "Watch" }));
    // 2026-09-08 is not today, so the queue says so; dispositions still apply.
    expect(screen.getByText("Not the live day")).toBeInTheDocument();
    const dispositions = screen.getByRole("list", { name: "Needs disposition" });
    const items = within(dispositions).getAllByRole("listitem");
    expect(items).toHaveLength(1); // left late within five minutes is a verification, not a disposition
    expect(items[0]).toHaveTextContent("Late over 5 · +12 min");
    expect(items[0]).toHaveTextContent("Route 477");
    expect(within(items[0]!).getByRole("button", { name: "Record disposition" })).toBeDisabled();
    await user.click(within(items[0]!).getByRole("button", { name: /Route 477/ }));
    expect(screen.getByRole("complementary", { name: "Trip details" })).toHaveTextContent("Route 477 · block 4 · 06:30");

    await user.click(screen.getByRole("tab", { name: "Timeline" }));
    const figure = screen.getByRole("figure", { name: "Trip starts by block" });
    expect(within(figure).getAllByRole("listitem")).toHaveLength(4); // one lane per block
    expect(within(figure).getByRole("button", { name: /Route 477/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(figure).queryByLabelText("Now")).not.toBeInTheDocument();

    // Filtering collapses the timeline to the blocks that still qualify.
    await user.click(screen.getByRole("button", { name: "Today's rotation" }));
    expect(within(screen.getByRole("figure", { name: "Trip starts by block" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("selects a row from the keyboard and the inspector follows", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    render(<TripStartLog />);
    const user = userEvent.setup();

    const table = await screen.findByRole("table", { name: "Dispatch log trips" });
    within(table).getAllByRole("row")[1]!.focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByRole("complementary", { name: "Trip details" })).toHaveTextContent("Route 460 · block 2 · 05:00");
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

  it("exports the whole day as a CSV download, and only once the day's log exists", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response([], { table_ready: false, materialized: false }));
    render(<TripStartLog />);
    await screen.findByText("Dispatch Log is not connected");
    expect(screen.getByRole("button", { name: "⬇ Export CSV" })).toBeDisabled();
    cleanup();

    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    vi.mocked(api.getTripStartLogCsv).mockResolvedValueOnce(new Blob(["\uFEFFVerified,Day of Week\r\n"], { type: "text/csv" }));
    const createObjectURL = vi.fn().mockReturnValue("blob:dispatch-log");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TripStartLog />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Dispatch log trips" });
    await user.click(screen.getByRole("button", { name: "⬇ Export CSV" }));

    expect(api.getTripStartLogCsv).toHaveBeenCalledWith("20260908");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:dispatch-log");
    click.mockRestore();
  });

  it("says when the export could not be produced", async () => {
    vi.mocked(api.getTripStartLog).mockResolvedValueOnce(response(DAY));
    vi.mocked(api.getTripStartLogCsv).mockRejectedValueOnce(new ApiError(503, "not connected"));
    render(<TripStartLog />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Dispatch log trips" });
    await user.click(screen.getByRole("button", { name: "⬇ Export CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Export failed: not connected");
  });

  it("names a failed request as unavailable rather than blaming the data", async () => {
    vi.mocked(api.getTripStartLog).mockRejectedValueOnce(new ApiError(503, "upstream down"));
    render(<TripStartLog />);

    expect(await screen.findByText("Dispatch Log unavailable")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("upstream down");
  });
});
