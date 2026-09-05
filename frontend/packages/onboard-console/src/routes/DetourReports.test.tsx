import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Detour } from "@mvta/shared";
import { DetourReports } from "./DetourReports.js";

vi.mock("../config.js", () => ({
  api: {
    getDetours: vi.fn(),
    getDetourReasonCodes: vi.fn(),
    getDetourCommunicationDeliveries: vi.fn(),
    getDetourAttachments: vi.fn(),
    getDetourWorkflowHistory: vi.fn(),
  },
}));

const { api } = await import("../config.js");

function detour(overrides: Partial<Detour> = {}): Detour {
  return {
    id: "d1", number: "951", internal_number: "MVTA-DET-2026-0012", closure: "5th St closed, Main to 3rd",
    start_date: "2026-09-01", end_date: "2026-09-05", is_monitor_only: false, riders_directed: null,
    email_sent: true, expired_email_sent: false, spare_emailed: false, source: "manual", external_detour_id: null,
    last_edited_manually: false, avail_last_seen_at: null, created_by: "ops@mvta", created_at: "2026-08-30T12:00:00.000Z",
    updated_by: null, updated_at: "2026-08-30T12:00:00.000Z", status: "active",
    fulfillment_mode: "avail", lifecycle_state: "awaiting_fulfillment", workflow_owner: "occ@mvta",
    readiness: "ready_for_avail_entry", communication_status: "draft", review_status: "current",
    closure_reason: null, segments: [{ id: "s1", detour_id: "d1", routes: "460 SB", directions: null, sort_order: 0 }],
    ...overrides,
  } as Detour;
}

const ROWS = [
  detour(),
  detour({ id: "d2", internal_number: "MVTA-DET-2026-0013", closure: "Cedar Ave water main", status: "expired", number: null }),
  detour({ id: "d3", internal_number: "MVTA-DET-2026-0014", closure: "Nicollet festival", status: "upcoming", source: "avail" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDetours).mockResolvedValue({ detours: ROWS } as never);
  vi.mocked(api.getDetourReasonCodes).mockResolvedValue({ reason_codes: [] } as never);
});

afterEach(cleanup);

function body() {
  return screen.getByRole("table").querySelector("tbody") as HTMLElement;
}

describe("DetourReports", () => {
  it("opens on Active, so the page answers 'what is out there right now' without a click", async () => {
    render(<DetourReports />);
    const active = await screen.findByRole("button", { name: /^Active/ });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(body()).getByText("5th St closed, Main to 3rd")).toBeInTheDocument();
    expect(within(body()).queryByText("Cedar Ave water main")).not.toBeInTheDocument();
  });

  it("counts each status against what the other filters already allow", async () => {
    render(<DetourReports />);
    const active = await screen.findByRole("button", { name: /^Active/ });
    expect(within(active).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /^Expired/ })).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /^All/ })).getByText("3")).toBeInTheDocument();
  });

  it("switches the table when another status is chosen", async () => {
    render(<DetourReports />);
    await userEvent.click(await screen.findByRole("button", { name: /^Expired/ }));
    expect(within(body()).getByText("Cedar Ave water main")).toBeInTheDocument();
    expect(within(body()).queryByText("5th St closed, Main to 3rd")).not.toBeInTheDocument();
  });

  it("keeps the status tab when the filters are cleared", async () => {
    render(<DetourReports />);
    await userEvent.click(await screen.findByRole("button", { name: /^Expired/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search detours" }), "cedar");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: /^Expired/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "Search detours" })).toHaveValue("");
  });

  it("no longer offers the legacy spreadsheet history or its import control", async () => {
    const { container } = render(<DetourReports />);
    await screen.findByRole("button", { name: /^Active/ });
    expect(screen.queryByText(/Legacy spreadsheet history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/imported rows/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("previews the export before it is downloaded, scoped to what is on screen", async () => {
    render(<DetourReports />);
    await userEvent.click(await screen.findByRole("button", { name: /Export 1 row/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^mvta-detours-\d{4}-\d{2}-\d{2}\.csv$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 detour · \d+ columns/)).toBeInTheDocument();
    expect(within(dialog).getByText("Active", { selector: ".dr-preview-scope" })).toBeInTheDocument();
    expect(within(dialog).getByRole("columnheader", { name: "Closure" })).toBeInTheDocument();
    expect(within(dialog).getByText("This is the whole file — every row and column it will contain.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Download CSV/ })).toBeInTheDocument();
  });

  it("names the filters in the preview scope so an exported file is self-describing", async () => {
    render(<DetourReports />);
    await userEvent.click(await screen.findByRole("button", { name: /^All/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search detours" }), "cedar");
    await userEvent.click(screen.getByRole("button", { name: /Export 1 row/ }));
    expect(within(screen.getByRole("dialog")).getByText("All statuses · “cedar”")).toBeInTheDocument();
  });

  it("says which status still has matches instead of just going blank", async () => {
    render(<DetourReports />);
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search detours" }), "cedar");
    expect(screen.getByText("No active detours match")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See all 1 match" }));
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  });
});
