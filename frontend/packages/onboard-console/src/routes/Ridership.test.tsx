import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type RidershipPrintStatus, type RidershipScanPage, type RidershipSheet, type RidershipWorklist, type RidershipWorklistSheet } from "@mvta/shared";
import { Ridership, SheetLink } from "./Ridership.js";
import { visibleAreas } from "../components/adminNav.js";
import { accessStateWith } from "../auth/AccessContext.js";
import { centralDay } from "../lib/ridership.js";

let actions: string[] = ["ridership.view", "ridership.enter", "ridership.print"];
vi.mock("../auth/AccessContext.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/AccessContext.js")>("../auth/AccessContext.js");
  return { ...actual, useAccess: () => actual.accessStateWith(actions) };
});

const getRidershipWorklist = vi.fn();
const getRidershipSheet = vi.fn();
const saveRidershipSheet = vi.fn();
const getRidershipPrintStatus = vi.fn();
const printRidershipSheets = vi.fn();
const getRidershipScanDesk = vi.fn();
const createRidershipScanUpload = vi.fn();
const submitRidershipScanUpload = vi.fn();
const updateRidershipScanPage = vi.fn();
const getRidershipScanImage = vi.fn();
vi.mock("../config.js", () => ({ api: {
  getRidershipScanDesk: (...args: unknown[]) => getRidershipScanDesk(...args),
  createRidershipScanUpload: (...args: unknown[]) => createRidershipScanUpload(...args),
  submitRidershipScanUpload: (...args: unknown[]) => submitRidershipScanUpload(...args),
  updateRidershipScanPage: (...args: unknown[]) => updateRidershipScanPage(...args),
  getRidershipScanImage: (...args: unknown[]) => getRidershipScanImage(...args),
  getRidershipWorklist: (...args: unknown[]) => getRidershipWorklist(...args),
  getRidershipSheet: (...args: unknown[]) => getRidershipSheet(...args),
  saveRidershipSheet: (...args: unknown[]) => saveRidershipSheet(...args),
  getRidershipPrintStatus: (...args: unknown[]) => getRidershipPrintStatus(...args),
  printRidershipSheets: (...args: unknown[]) => printRidershipSheets(...args),
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
    { trip_id: `${block}-1`, route_short_name: "460", route_label: "460", trip_number: "600-N", direction_label: "N", scheduled_start_seconds: 21600, scheduled_end_seconds: 24000, start_status: "on_time", required: true, excused_reason: null, entry: null },
    { trip_id: `${block}-2`, route_short_name: "460", route_label: "460", trip_number: null, direction_label: "S", scheduled_start_seconds: 25200, scheduled_end_seconds: 27000, start_status: "unknown", required: true, excused_reason: null, entry: null },
  ],
  added_trips: [], progress: progress(2), history: [],
  ...overrides,
});

function renderPage(path = "/ridership") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ridership" element={<Ridership />} />
        <Route path="/r/:date/:block" element={<SheetLink />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Ridership › Enter sheets", () => {
  beforeEach(() => {
    actions = ["ridership.view", "ridership.enter", "ridership.print"];
    getRidershipWorklist.mockReset().mockResolvedValue(WORKLIST);
    getRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block));
    saveRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block, { state: "entered", version: "v1" }));
    getRidershipPrintStatus.mockReset().mockResolvedValue(printStatus(null, []));
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
    const first = await screen.findByLabelText("Boardings, 460 N 6:00 AM");
    expect(document.activeElement).toBe(first);
    await user.keyboard("12{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Boardings, 460 S 7:00 AM"));
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

  it("names each trip as the paper sheet does, with Avail's trip number beneath", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "105" }));
    const row = (await screen.findByLabelText("Boardings, 460 N 6:00 AM")).closest("tr")!;
    expect(within(row).getByText("6:00 AM – 6:40 AM")).toBeTruthy();
    expect(within(row).getByTitle("Avail trip 600-N · GTFS trip ID 105-1").textContent).toBe("Trip 600-N");
    // A GTFS id not in MVTA's form has no Avail number, so the id shows instead.
    const other = screen.getByLabelText("Boardings, 460 S 7:00 AM").closest("tr")!;
    expect(within(other).getByTitle("Avail trip ? · GTFS trip ID 105-2").textContent).toBe("105-2");
  });

  it("shows a route by the guide's number, with its GTFS name on hover", async () => {
    getRidershipSheet.mockImplementation(async (date: string, block: string) => {
      const sheet = sheetFor(date, block);
      return { ...sheet, trips: sheet.trips.map((t) => ({ ...t, route_short_name: "Orange LINK", route_label: "425" })) };
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "105" }));
    const row = (await screen.findByLabelText("Boardings, 425 N 6:00 AM")).closest("tr")!;
    expect(within(row).getByTitle("Orange LINK").textContent).toBe("425");
  });

  it("fetches the next sheet while this one is keyed, so Save opens it at once", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, 460 N 6:00 AM");
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
    await screen.findByLabelText("Boardings, 460 N 6:00 AM");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/2 trips still blank/);
    expect(document.activeElement).toBe(screen.getByLabelText("Boardings, 460 N 6:00 AM"));
    expect(saveRidershipSheet).not.toHaveBeenCalled();
  });

  it("Esc returns to the worklist, and asks twice when there are unsaved changes", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Boardings, 460 N 6:00 AM");
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
    await screen.findByLabelText("Boardings, 460 N 6:00 AM");
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

  it("keys the sheet's relief or bus change: Avail's next run pre-fills, the sheet's trip # says from when", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "024" }));
    await user.click(await screen.findByRole("button", { name: "Add relief or bus change" }));
    const line = screen.getByRole("group", { name: "Relief or bus change" });
    expect((within(line).getByLabelText("Operator") as HTMLInputElement).value).toBe("Test Operator Relief");
    expect((within(line).getByLabelText("Bus") as HTMLInputElement).value).toBe("4402");
    // Trip #1 is the header's operator; the line starts from #2 or later.
    const from = within(line).getByLabelText("From trip") as HTMLSelectElement;
    expect([...from.options].map((o) => o.textContent)).toEqual(["Choose the sheet's trip #", "#2 · 7:00 AM · 460 S"]);
    await user.selectOptions(from, "024-2");
    expect(screen.getByText("Relief or bus change from here")).toBeTruthy();
    await user.type(screen.getByLabelText("Boardings, 460 N 6:00 AM"), "12");
    await user.type(screen.getByLabelText("Boardings, 460 S 7:00 AM"), "9");
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(saveRidershipSheet).toHaveBeenCalledWith("20261130", "024", expect.objectContaining({
      operator_name: "Test Operator A",
      change: { from_trip_id: "024-2", operator_name: "Test Operator Relief", operator_id: "9002", bus: "4402" },
    })));
  });

  it("opens a sheet from a scanned QR link", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText("Scan or type block"), "https://operator.onboard.example/r/20261130/212{Enter}");
    expect(await screen.findByRole("heading", { name: "Block 212" })).toBeTruthy();
    expect(getRidershipSheet).toHaveBeenCalledWith("20261130", "212");
  });

  it("a printed sheet's QR link opens that sheet", async () => {
    renderPage("/r/20261130/24");
    expect(await screen.findByRole("heading", { name: "Block 024" })).toBeTruthy();
    expect(getRidershipSheet).toHaveBeenCalledWith("20261130", "024");
  });

  it("says when migration 153 is missing", async () => {
    getRidershipWorklist.mockRejectedValue(new ApiError(503, "not ready"));
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toMatch(/migration 153/);
  });
});

// --- Print sheets ---------------------------------------------------------------

const printRow = (block: string, order: number, state: RidershipPrintStatus["sheets"][number]["state"], garage: string | null = "Burnsville") => ({
  block, garage, order, first_start_seconds: 18000 + order * 600, trips: 6, pages: 1, state,
  printed_at: state === "not_printed" ? null : "2026-12-01T03:05:00Z", printed_by: state === "not_printed" ? null : "desk@example.test",
});

function printStatus(garage: string | null, sheets: RidershipPrintStatus["sheets"], printed = false): RidershipPrintStatus {
  const lastPrint = printed ? { printed_at: "2026-12-01T03:05:00Z", printed_by: "desk@example.test", scope: "garage" as const, sheets: sheets.length, pages: sheets.length, blank_backs: false } : null;
  return {
    service_date: "20261202", garage, garages: ["Burnsville", "Eagan", null], sheets,
    last_print: lastPrint, prints: lastPrint ? [lastPrint] : [],
    not_printed: sheets.filter((s) => s.state === "not_printed").length, changed: sheets.filter((s) => s.state === "changed").length,
    dropped: [],
  };
}

const morningNote = () => screen.queryAllByRole("note").find((n) => /changed after printing/.test(n.textContent ?? "")) ?? null;

describe("Ridership › Print sheets", () => {
  const opened = { location: { href: "" }, close: vi.fn() };

  beforeEach(() => {
    actions = ["ridership.view", "ridership.enter", "ridership.print"];
    window.localStorage.clear();
    getRidershipWorklist.mockReset().mockResolvedValue(WORKLIST);
    getRidershipPrintStatus.mockReset().mockImplementation(async ({ garage }: { garage?: string | null }) =>
      garage === "Eagan"
        ? printStatus("Eagan", [printRow("212", 1, "not_printed", "Eagan")])
        : garage === null
        ? printStatus(null, [printRow("330", 1, "not_printed", null), printRow("331", 2, "not_printed", null)])
        : printStatus(garage ?? "Burnsville", [printRow("024", 1, "not_printed"), printRow("105", 2, "not_printed")]));
    printRidershipSheets.mockReset().mockResolvedValue(new Blob(["%PDF-"], { type: "application/pdf" }));
    opened.location.href = "";
    vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
    URL.createObjectURL = vi.fn(() => "blob:count-sheets");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("lists tomorrow's sheets for one garage, in pull-out order, not printed yet", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("tab", { name: "Print sheets" }));
    expect(await screen.findByText(/Not printed yet/)).toBeTruthy();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["024", "105"]);
    expect((screen.getByLabelText("Garage") as HTMLSelectElement).value).toBe("Burnsville");
    expect(getRidershipPrintStatus).toHaveBeenCalledWith(expect.objectContaining({ garage: "Burnsville" }));
    expect(screen.getByRole("button", { name: "Print 2 sheets · Burnsville" })).toBeTruthy();
  });

  it("prints the garage's stack as a PDF, with blank backs when asked, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    await user.click(await screen.findByLabelText(/Blank back on each page/));
    await user.click(screen.getByRole("button", { name: "Print 2 sheets · Burnsville" }));
    await waitFor(() => expect(printRidershipSheets).toHaveBeenCalledTimes(1));
    expect(printRidershipSheets).toHaveBeenCalledWith(expect.objectContaining({
      garage: "Burnsville", blank_backs: true, link_base: expect.stringMatching(/^http:\/\/localhost/),
    }));
    expect(printRidershipSheets.mock.calls[0][0].blocks).toBeUndefined();
    expect(window.open).toHaveBeenCalledBefore(printRidershipSheets);
    await waitFor(() => expect(opened.location.href).toBe("blob:count-sheets"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Opened the stack for Burnsville/);
    expect(window.localStorage.getItem("ridership.print.blankBacks")).toBe("true");
  });

  it("flags a block changed since printing, and reprints just that one", async () => {
    getRidershipPrintStatus.mockImplementation(async () => printStatus("Burnsville", [printRow("024", 1, "printed"), printRow("105", 2, "changed")], true));
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    expect(await screen.findByText(/The Dispatch Log has changed since printing/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reprint just that sheet" }));
    await waitFor(() => expect(printRidershipSheets).toHaveBeenCalledWith(expect.objectContaining({ garage: "Burnsville", blocks: ["105"] })));
  });

  it("tells the desk to take back a printed sheet for a block that no longer runs", async () => {
    getRidershipPrintStatus.mockImplementation(async () => ({
      ...printStatus("Burnsville", [printRow("024", 1, "printed")], true),
      dropped: [{ block: "330", printed_at: "2026-12-01T03:05:00Z", printed_by: "desk@example.test" }],
    }));
    renderPage("/ridership?tab=print");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Block 330 no longer runs .* Take it back/);
  });

  it("calls out today's sheets that changed after the evening print, and reprints them for today", async () => {
    const today = centralDay(0).replace(/-/g, "");
    getRidershipPrintStatus.mockImplementation(async ({ date, garage }: { date?: string; garage?: string | null }) => date === today
      ? { ...printStatus(garage ?? "Burnsville", [printRow("024", 1, "printed"), printRow("105", 2, "changed"), printRow("106", 3, "not_printed")], true),
        dropped: [{ block: "330", printed_at: "2026-12-01T03:05:00Z", printed_by: "desk@example.test" }] }
      : printStatus("Burnsville", [printRow("024", 1, "not_printed")]));
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    // The tab counts every garage's; the note is the chosen garage's.
    expect(await screen.findByRole("tab", { name: /Print sheets\s*3 to reprint today/ })).toBeTruthy();
    // The Unassigned warning is a note too; the morning one names today.
    await waitFor(() => expect(morningNote()).not.toBeNull());
    const note = morningNote()!;
    expect(note.textContent).toMatch(/3 sheets changed after printing for Burnsville/);
    expect(note.textContent).toMatch(/changed block 105/);
    expect(note.textContent).toMatch(/Block 106 is new since printing/);
    expect(note.textContent).toMatch(/Take back the sheet for block 330/);
    await user.click(within(note).getByRole("button", { name: "Reprint today's 2 sheets" }));
    await waitFor(() => expect(printRidershipSheets).toHaveBeenCalledWith(expect.objectContaining({ date: today, garage: "Burnsville", blocks: ["105", "106"] })));
  });

  it("shows no morning note when today's printed sheets are current", async () => {
    getRidershipPrintStatus.mockImplementation(async ({ garage }: { garage?: string | null }) => printStatus(garage ?? "Burnsville", [printRow("024", 1, "printed")], true));
    renderPage("/ridership?tab=print");
    await screen.findByText(/nothing has changed since/);
    expect(morningNote()).toBeNull();
    expect(screen.getByRole("tab", { name: "Print sheets" })).toBeTruthy();
  });

  it("says when everything printed is still current", async () => {
    getRidershipPrintStatus.mockImplementation(async () => printStatus("Burnsville", [printRow("024", 1, "printed")], true));
    renderPage("/ridership?tab=print");
    expect((await screen.findByText(/nothing has changed since/)).textContent).toMatch(/desk@example\.test/);
  });

  it("opens straight on Print sheets for the check-in desk, which holds print only", async () => {
    actions = ["ridership.print"];
    renderPage();
    expect(await screen.findByRole("button", { name: "Print 2 sheets · Burnsville" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(getRidershipWorklist).not.toHaveBeenCalled();
  });

  it("tells a garage's desk which blocks have no garage, and opens them", async () => {
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    const note = await screen.findByRole("note");
    expect(note.textContent).toMatch(/2 blocks have no garage .* not in any garage's stack: 330 and 331\. Print them from Unassigned/);
    await user.click(within(note).getByRole("button", { name: "Unassigned" }));
    expect(await screen.findByRole("button", { name: "Print 2 sheets · Unassigned" })).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText(/These blocks have no garage/)).toBeTruthy();
  });

  it("says nothing about Unassigned when every block has a garage", async () => {
    getRidershipPrintStatus.mockImplementation(async () => ({ ...printStatus("Burnsville", [printRow("024", 1, "not_printed")]), garages: ["Burnsville"] }));
    renderPage("/ridership?tab=print");
    await screen.findByText(/Not printed yet/);
    expect(screen.queryByRole("note")).toBeNull();
    expect(getRidershipPrintStatus).not.toHaveBeenCalledWith(expect.objectContaining({ garage: null }));
  });

  it("switches garage, and keeps the desk's garage for next time", async () => {
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    await screen.findByText(/Not printed yet/);
    await user.selectOptions(screen.getByLabelText("Garage"), "Eagan");
    expect(await screen.findByRole("button", { name: "Print 1 sheet · Eagan" })).toBeTruthy();
    cleanup();
    renderPage("/ridership?tab=print");
    expect(await screen.findByRole("button", { name: "Print 1 sheet · Eagan" })).toBeTruthy();
  });

  it("shows the API's reason when printing fails, and closes the empty tab", async () => {
    printRidershipSheets.mockRejectedValue(new ApiError(503, "Count Sheet printing is not set up in this environment yet. Apply migration 157."));
    const user = userEvent.setup();
    renderPage("/ridership?tab=print");
    await user.click(await screen.findByRole("button", { name: "Print 2 sheets · Burnsville" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/migration 157/);
    expect(opened.close).toHaveBeenCalled();
  });
});

// --- Upload scans (migration 163) -------------------------------------------------

const scanPage = (over: Partial<RidershipScanPage>): RidershipScanPage => ({
  page_id: "p1", page_number: 1, state: "matched", reason: null, service_date: "20261130", block: "024", sheet_page: 1,
  identified_by: "qr", straightened: true, printed_at: "2026-11-30T03:10:00Z", date_flag: false, processed_at: "2026-12-01T04:00:00Z", assigned_by: null, ...over,
});

describe("Ridership › Upload scans", () => {
  beforeEach(() => {
    actions = ["ridership.print", "ridership.scan"];
    window.localStorage.clear();
    getRidershipWorklist.mockReset().mockResolvedValue(WORKLIST);
    getRidershipPrintStatus.mockReset().mockResolvedValue(printStatus("Burnsville", []));
    getRidershipScanDesk.mockReset().mockResolvedValue({
      service_date: "20261130", garage: "Burnsville", unassigned: 1,
      expected: [{ block: "024", pages: 1, scanned_pages: 1 }, { block: "105", pages: 1, scanned_pages: 0 }],
      uploads: [{
        upload_id: "u1", garage: "Burnsville", file_name: "shift.pdf", status: "done", status_detail: null, page_count: 3, created_at: "", created_by: "desk@example.test",
        pages: [scanPage({}), scanPage({ page_id: "p2", page_number: 2, state: "blank", block: null, service_date: null, sheet_page: null, identified_by: null }),
          scanPage({ page_id: "p3", page_number: 3, state: "unreadable", reason: "not_identified", block: null, service_date: null, sheet_page: null, identified_by: null })],
      }],
    });
    createRidershipScanUpload.mockReset().mockResolvedValue({ upload_id: "u2", upload_url: "https://scans.example.test/count-sheet-originals/u2.pdf?sig" });
    submitRidershipScanUpload.mockReset().mockResolvedValue({});
    updateRidershipScanPage.mockReset().mockResolvedValue(scanPage({ page_id: "p3", identified_by: "person" }));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("the desk sees Print sheets and Upload scans, and never the Count Sheets", async () => {
    renderPage();
    const tabs = await screen.findByRole("tablist");
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Print sheets", "Upload scans"]);
    expect(getRidershipWorklist).not.toHaveBeenCalled();
  });

  it("lists each page's outcome with no image, the sheets not scanned, and a page that needs the desk", async () => {
    renderPage("/ridership?tab=scan");
    expect((await screen.findByLabelText("Sheets still to scan")).textContent).toMatch(/1 of 2 sheets scanned\. Not scanned yet: 105\./);
    expect(screen.getByText("3 pages · 1 recognised · 1 blank · 1 needs you")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("The QR code could not be read.")).toBeTruthy();
  });

  it("the desk types an unreadable page's block from the paper", async () => {
    const user = userEvent.setup();
    renderPage("/ridership?tab=scan");
    await user.type(await screen.findByLabelText("Block for page 3"), "105");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateRidershipScanPage).toHaveBeenCalledWith("p3", expect.objectContaining({ action: "assign", block: "105", sheet_page: 1 })));
  });

  it("uploads the PDF straight to storage, then submits its SHA-256", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    const user = userEvent.setup();
    renderPage("/ridership?tab=scan");
    const file = new File(["%PDF-1.4 synthetic"], "shift.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText("Choose the scanned PDF to upload"), file);
    await waitFor(() => expect(submitRidershipScanUpload).toHaveBeenCalledWith("u2", expect.stringMatching(/^[0-9a-f]{64}$/)));
    expect(createRidershipScanUpload).toHaveBeenCalledWith(expect.objectContaining({ file_name: "shift.pdf", garage: "Burnsville", size_bytes: file.size }));
    expect(fetchMock).toHaveBeenCalledWith("https://scans.example.test/count-sheet-originals/u2.pdf?sig", expect.objectContaining({ method: "PUT" }));
  });
});

describe("Ridership › scans on Enter sheets", () => {
  beforeEach(() => {
    actions = ["ridership.view", "ridership.enter", "ridership.scans.view"];
    getRidershipWorklist.mockReset().mockResolvedValue({
      ...WORKLIST,
      sheets: WORKLIST.sheets.map((s) => ({ ...s, scan: s.block === "024" ? "scanned" : s.block === "212" ? "not_scanned" : null })),
    });
    getRidershipSheet.mockReset().mockImplementation(async (date: string, block: string) => sheetFor(date, block, { scan: { pages: [scanPage({})], can_view_images: true } }));
    getRidershipScanImage.mockReset().mockResolvedValue({ url: "https://scans.example.test/page.jpg?sig", expires_at: "" });
  });
  afterEach(cleanup);

  it("marks sheets Scanned and Not scanned", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("Scanned")).toHaveLength(1);
    expect(within(table).getAllByText("Not scanned")).toHaveLength(1);
  });

  it("opens the scan beside the sheet, through a logged link", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "024" }));
    const image = await screen.findByRole("img", { name: /Scan of block 024/ });
    expect(image.getAttribute("src")).toBe("https://scans.example.test/page.jpg?sig");
    expect(getRidershipScanImage).toHaveBeenCalledWith("p1");
  });

  it("without ridership.scans.view the sheet says it is scanned and opens no image", async () => {
    actions = ["ridership.view", "ridership.enter"];
    getRidershipSheet.mockImplementation(async (date: string, block: string) => sheetFor(date, block, { scan: { pages: [scanPage({})], can_view_images: false } }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "024" }));
    expect(await screen.findByText(/This sheet is scanned/)).toBeTruthy();
    expect(getRidershipScanImage).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
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
    expect(screen.queryByRole("tab", { name: "Print sheets" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "105" }));
    expect((await screen.findByLabelText("Boardings, 460 N 6:00 AM") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });

  it("Ridership setup is an Administration page only ridership.configure opens", () => {
    const pages = (held: string[]) => visibleAreas(accessStateWith(held).can).flatMap((a) => a.pages.map((p) => p.label));
    expect(pages(["ridership.view", "ridership.enter", "ridership.print"])).toEqual([]);
    expect(pages(["ridership.view", "ridership.configure"])).toEqual(["Ridership setup"]);
  });
});
