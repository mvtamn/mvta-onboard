import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { KpiTrustStream } from "@mvta/shared";
import { IntegrationsHealth } from "./IntegrationsHealth.js";
import { KPI_TRUST_STREAMS } from "./kpiTrustPresentation.js";

const { getFeedChecks, getKpiTrust } = vi.hoisted(() => ({ getFeedChecks: vi.fn(), getKpiTrust: vi.fn() }));
vi.mock("../../config.js", () => ({ api: { getFeedChecks, getKpiTrust } }));

function stream(
  state: KpiTrustStream["state"],
  lastSuccessAt: string | null,
  extra: Partial<KpiTrustStream> = {},
): KpiTrustStream {
  return {
    state,
    contract_pending: false,
    explanation: state === "current" ? "Required feed dependencies are current." : "A required feed dependency is beyond its freshness contract.",
    dependencies: [{
      feed_name: "gtfs_trip_updates", required: true, state: state === "current_but_empty" ? "current" : state,
      last_success_at: lastSuccessAt, source_timestamp_at: lastSuccessAt,
      coverage_start_at: null, coverage_end_at: null, stale_after_minutes: 15,
      last_failure_at: null, last_failure_reason: null,
    }],
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IntegrationsHealth", () => {
  it("loads KPI trust as the page opens and puts the streams needing attention first", async () => {
    getKpiTrust.mockResolvedValue({
      checked_at: "2026-09-06T14:42:00Z",
      streams: {
        fixed_route_delay: stream("current", "2026-09-06T14:41:00Z"),
        on_demand: stream("stale", "2026-09-06T12:58:00Z"),
        event_avl: stream("unavailable", null, {
          explanation: "A required feed dependency has not recorded a successful ingestion.",
          dependencies: [{
            feed_name: "avail_avl", required: true, state: "unavailable", last_success_at: null, source_timestamp_at: null,
            coverage_start_at: null, coverage_end_at: null, stale_after_minutes: 2,
            last_failure_at: "2026-09-06T14:12:00Z", last_failure_reason: "AVAIL_AVL_REPORTS_URL returned 401",
          }],
        }),
        on_demand_departures: stream("current_but_empty", "2026-09-06T14:35:00Z"),
      },
    });

    render(<IntegrationsHealth />);

    const board = await screen.findByRole("heading", { name: "Event AVL" });
    expect(board).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Event AVL", "On-demand wait times", "On-demand departures", "Fixed route delays"]);

    // The summary counts current strictly: a stream with no records is
    // reported on its own, and the two degraded states are "attention".
    const summary = screen.getByLabelText("Data health summary");
    expect(within(summary).getByText("1 of 4")).toBeInTheDocument();
    expect(within(summary).getByText("2 need attention · 1 no records")).toBeInTheDocument();
    expect(within(summary).getByText("Not checked this session.")).toBeInTheDocument();

    // A failed required dependency is named on its card, with the reason.
    expect(screen.getByText("AVAIL_AVL_REPORTS_URL returned 401")).toBeInTheDocument();
    expect(getFeedChecks).not.toHaveBeenCalled();
  });

  it("switches to module order on request", async () => {
    getKpiTrust.mockResolvedValue({
      checked_at: "2026-09-06T14:42:00Z",
      streams: {
        fixed_route_delay: stream("current", "2026-09-06T14:41:00Z"),
        on_demand: stream("stale", "2026-09-06T12:58:00Z"),
      },
    });
    render(<IntegrationsHealth />);
    await screen.findByRole("heading", { name: "On-demand wait times" });

    await userEvent.setup().click(screen.getByRole("button", { name: "By module" }));

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Fixed route delays", "On-demand wait times"]);
  });

  it("labels every stream distinctly when all of them are shown", async () => {
    // The cards sit together with no module around them to say which KPI each
    // is about; two sharing a label would leave an administrator guessing.
    const streams = Object.fromEntries(KPI_TRUST_STREAMS.map((name) => [name, stream("stale", "2026-09-06T12:00:00Z")]));
    getKpiTrust.mockResolvedValue({ checked_at: "2026-09-06T14:42:00Z", streams });
    render(<IntegrationsHealth />);
    await screen.findByRole("heading", { name: "Event AVL" });

    const headings = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toHaveLength(KPI_TRUST_STREAMS.length);
    expect(new Set(headings).size).toBe(KPI_TRUST_STREAMS.length);
  });

  it("shows live, empty, and failed feed results after an explicit check, with the failure under its row", async () => {
    getKpiTrust.mockResolvedValue({ checked_at: "2026-09-06T14:42:00Z", streams: { fixed_route_delay: stream("current", "2026-09-06T14:41:00Z") } });
    getFeedChecks.mockResolvedValueOnce({
      checked_at: "2026-09-06T14:43:00Z",
      checks: [
        { name: "GTFS TripUpdates", configured: true, status: 200, records: 134 },
        { name: "Avail Pullout", configured: true, status: 200, records: 0 },
        { name: "Avail AVL", configured: true, status: 401 },
        { name: "Spare missed-trip Slots ingestion", configured: true, records: 24, freshness: "current", last_success_at: "2026-09-06T14:40:00Z" },
        { name: "Spare Requests", configured: false },
      ],
    });
    render(<IntegrationsHealth />);
    await screen.findByRole("heading", { name: "Fixed route delays" });

    await userEvent.setup().click(screen.getByRole("button", { name: "Check feeds" }));

    const table = await screen.findByRole("table", { name: "Feed check results" });
    expect(within(table).getByText("Live")).toBeInTheDocument();
    expect(within(table).getByText("Empty")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("Current")).toBeInTheDocument();
    expect(within(table).getByText("Not configured")).toBeInTheDocument();
    expect(within(table).getByText("HTTP 401 from the source.")).toBeInTheDocument();

    // Reachability counts configured sources only, and names what failed.
    const summary = screen.getByLabelText("Data health summary");
    expect(within(summary).getByText("3 of 4")).toBeInTheDocument();
    expect(within(summary).getByText("Avail AVL failed")).toBeInTheDocument();
    expect(getFeedChecks).toHaveBeenCalledOnce();
    // Trust is refreshed with the check so both halves describe one moment.
    expect(getKpiTrust).toHaveBeenCalledTimes(2);
  });

  it("keeps connection diagnostics available when KPI trust is unavailable", async () => {
    getKpiTrust.mockRejectedValue(new Error("trust unavailable"));
    getFeedChecks.mockResolvedValueOnce({
      checked_at: "2026-09-06T14:43:00Z",
      checks: [{ name: "GTFS TripUpdates", configured: true, status: 200, records: 134 }],
    });
    render(<IntegrationsHealth />);
    expect(await screen.findByRole("alert")).toHaveTextContent("KPI trust could not be loaded");

    await userEvent.setup().click(screen.getByRole("button", { name: "Check feeds" }));

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
