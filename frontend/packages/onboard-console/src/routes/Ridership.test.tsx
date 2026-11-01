import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type RidershipSheet, type RidershipWorklist, type RidershipWorklistSheet } from "@mvta/shared";
import { Ridership } from "./Ridership.js";
import { visibleAreas } from "../components/adminNav.js";
import { accessStateWith } from "../auth/AccessContext.js";

let actions: string[] = ["ridership.view", "ridership.enter", "ridership.print"];
vi.mock("../auth/AccessContext.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/AccessContext.js")>("../auth/AccessContext.js");
  return { ...actual, useAccess: () => actual.accessStateWith(actions) };
});

const getRidershipWorklist = vi.fn();
const getRidershipSheet = vi.fn();
const saveRidershipSheet = vi.fn();
vi.mock("../config.js", () => ({ api: {
  getRidershipWorklist: (...args: unknown[]) => getRidershipWorklist(...args),
  getRidershipSheet: (...args: unknown[]) => getRidershipSheet(...args),
  saveRidershipSheet: (...args: unknown[]) => saveRidershipSheet(...args),
} }));

const progress = (required: number, keyed = 0) => ({ trips: required, required, keyed, counted: keyed, not_counted: 0, did_not_operate: 0, added_trips: 0, boardings: 0 });
const row = (service_date: string, block: string, state: RidershipWorklistSheet["state"], garage: string | null = "Burnsville"): RidershipWorklistSheet => ({
  service_date, block, garage, state, due_at: "", first_start_seconds: 20000, entered_at: null, entered_by: null, reconstructed: false, progress: progress(2),
});

// The API orders the worklist (late first); the console keeps that order.
const WORKLIST: RidershipWorklist = {
  from: "20261124", to: "20261201", generated_at: "2026-12-01T15:00:00Z",
  sheets: [row("20261129", "105", "late", null), row("20261130", "024", "not_entered"), row("20261130", "212", "in_progress", "Eagan"), row("20261129", "001", "entered")],
  garages: [
    { garage: "Burnsville", sheets: 2, entered: 1, entered_late: 0, late: 0, open: 1, required_trips: 4, missing_trips: 2, not_counted_trips: 0 },
    { garage: "Eagan", sheets: 1, entered: 0, entered_late: 0, late: 0, open: 1, required_trips: 2, missing_trips: 1, not_counted_trips: 0 },
    { garage: null, sheets: 1, entered: 0, entered_late: 0, late: 1, open: 1, required_trips: 2, missing_trips: 2, not_counted_trips: 0 },
  ],
  trips_without_block: 0,
};

const sheetFor = (service_date: string, block: string, overrides: Partial<RidershipSheet> = {}): RidershipSheet => ({
  service_date, block, garage: "Burnsville", state: "not_entered", due_at: "",
  pullout: { prefill: { run: 1, operator_name: "Test Operator A", operator_id: "9001", bus: "4401" }, other_runs: [{ run: 2, operator_name: "Test Operator Relief", operator_id: "9002", bus: "4402" }] },
  header: null, version: null,
  trips: [
    { trip_id: `${block}-1`, route_short_name: "460", direction_label: "N", scheduled_start_seconds: 21600, scheduled_end_seconds: 24000, start_status: "on_time", required: true, excused_reason: null, entry: null },
    { trip_id: `${block}-2`, route_short_name: "460", direction_label: "S", scheduled_start_seconds: 25200, scheduled_end_seconds: 27000, start_status: "unknown", required: true, excused_reason: null, entry: null },
  ],
  added_trips: [], progress: progress(2), history: [],
  ...overrides,
});

function renderPage() {
  render(<Ridership />);
}

describe("Ridership › Enter sheets", () => {
  beforeEach(() => {
    actions = ["ridership.view", "ridership.enter", "ridership.print"];
    getRidershipWorklist.mockReset().mockResolvedValue(WORKLIST);
    getRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block));
    saveRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block, { state: "entered", version: "v1" }));
  });
  afterEach(cleanup);

  it("lists open sheets late first, with completeness by garage and Unassigned shown", async () => {
    renderPage();
    const list = await screen.findByRole("table");
    const rows = within(list).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[2].textContent)).toEqual(["105", "024", "212"]);
    expect(within(rows[0]).getByText("Late")).toBeTruthy();
    expect(within(rows[0]).getByText("Unassigned")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Burnsville\s*50%/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unassigned\s*0%.*1 late/ })).toBeTruthy();
    expect(screen.getByText("Entered (1)")).toBeTruthy();
  });

  it("filters to one garage's sheets", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Eagan/ }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(screen.getByText(/Sheets to enter \(1\)/)).toBeTruthy();
  });

  it("keys a sheet with Enter alone: down the trips, onto Save, then the next sheet", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    // The first sheet opens with its first blank trip focused.
    const first = await screen.findByLabelText("Boardings, trip 105-1");
    expect(document.activeElement).toBe(first);
    await user.keyboard("12{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Boardings, trip 105-2"));
    await user.keyboard("n{Enter}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Save · next sheet/ }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(saveRidershipSheet).toHaveBeenCalledTimes(1));
    expect(saveRidershipSheet).toHaveBeenCalledWith("20261129", "105", expect.objectContaining({
      version: null,
      operator_name: "Test Operator A",
      trips: [
        { trip_id: "105-1", count_status: "counted", boardings: 12 },
        { trip_id: "105-2", count_status: "not_counted", boardings: null },
      ],
    }));
    // Save goes straight to the next sheet in the queue.
    expect(await screen.findByRole("heading", { name: "Block 024" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Block 105 .* saved\. Now on block 024/);
  });

  it("fetches the next sheet while this one is keyed, so Save opens it at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, trip 105-1");
    await waitFor(() => expect(getRidershipSheet).toHaveBeenCalledWith("20261130", "024"));
    await user.keyboard("1{Enter}2{Control>}{Enter}{/Control}");
    expect(await screen.findByRole("heading", { name: "Block 024" })).toBeTruthy();
    // Opened from the copy fetched ahead, not fetched again.
    expect(getRidershipSheet.mock.calls.filter(([, block]) => block === "024")).toHaveLength(1);
    // Fetching ahead goes on to the sheet after it.
    await waitFor(() => expect(getRidershipSheet).toHaveBeenCalledWith("20261130", "212"));
  });

  it("refuses to save with a blank trip and puts the cursor on it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, trip 105-1");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/2 trips still blank/);
    expect(document.activeElement).toBe(screen.getByLabelText("Boardings, trip 105-1"));
    expect(saveRidershipSheet).not.toHaveBeenCalled();
  });

  it("Esc returns to the worklist, and asks twice when there are unsaved changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, trip 105-1");
    await user.keyboard("7{Escape}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/not saved/);
    expect(screen.getByRole("heading", { name: "Block 105" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(await screen.findByText(/Sheets to enter/)).toBeTruthy();
  });

  it("shows when someone else saved the sheet first, and reloads it", async () => {
    const user = userEvent.setup();
    saveRidershipSheet.mockRejectedValueOnce(new ApiError(409, "Someone else saved this sheet after you opened it. Reload it to see their changes."));
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, trip 105-1");
    await user.keyboard("1{Enter}2{Control>}{Enter}{/Control}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Someone else saved/);
    const before = getRidershipSheet.mock.calls.filter(([, block]) => block === "105").length;
    await user.click(screen.getByRole("button", { name: "Reload the sheet" }));
    await waitFor(() => expect(getRidershipSheet.mock.calls.filter(([, block]) => block === "105")).toHaveLength(before + 1));
  });

  it("fills a relief run's operator and bus, and says it differs from Avail", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "024" }));
    await user.click(await screen.findByRole("button", { name: /run 2: Test Operator Relief/ }));
    expect((screen.getByLabelText("Operator") as HTMLInputElement).value).toBe("Test Operator Relief");
    expect(screen.getByText(/Changed from Avail/)).toBeTruthy();
  });

  it("opens a sheet from a scanned QR link", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText("Scan or type block"), "https://operator.onboard.example/r/20261130/212{Enter}");
    expect(await screen.findByRole("heading", { name: "Block 212" })).toBeTruthy();
    expect(getRidershipSheet).toHaveBeenCalledWith("20261130", "212");
  });

  it("says when migration 153 is missing", async () => {
    getRidershipWorklist.mockRejectedValue(new ApiError(503, "not ready"));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/migration 153/);
  });
});

describe("Ridership gating", () => {
  afterEach(cleanup);

  it("without ridership.enter the sheets are read-only", async () => {
    actions = ["ridership.view"];
    getRidershipWorklist.mockReset().mockResolvedValue(WORKLIST);
    getRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block));
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Start entering/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "105" }));
    expect((await screen.findByLabelText("Boardings, trip 105-1") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("Ridership setup is an Administration page only ridership.configure opens", () => {
    const pages = (held: string[]) => visibleAreas(accessStateWith(held).can).flatMap((a) => a.pages.map((p) => p.label));
    expect(pages(["ridership.view", "ridership.enter", "ridership.print"])).toEqual([]);
    expect(pages(["ridership.view", "ridership.configure"])).toEqual(["Ridership setup"]);
  });
});
