import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpComplianceAdmin } from "./OtpComplianceAdmin.js";
import { OtpModule } from "./modules/otp/OtpModule.js";
import { AppDialogProvider } from "../components/AppDialog.js";

vi.mock("../config.js", () => ({ api: {
  getOtpSettings: vi.fn().mockResolvedValue({ early_late_bias_threshold: 0.25 }),
  updateOtpSettings: vi.fn(),
  getReasonCodes: vi.fn().mockResolvedValue({ reason_codes: [
    { id: "rc1", code: "SIGNAL", label: "Signal timing", applies_to: "stop", sort_order: 1, is_active: true },
  ] }),
  createReasonCode: vi.fn(),
  updateReasonCode: vi.fn(),
  // The server decides which stops are flagged and how many (ADR 0034); the
  // console renders the answer. `threshold` is the tuner's trial value.
  getOtpMonthly: vi.fn().mockImplementation((_month?: string, threshold?: number) =>
    Promise.resolve({
      flagged: [
        { route_id: 490, route_label: "490", stop_id: 13209, stop_name: "Wash/Coffman SW", day_of_week: "Monday", total: 34, pct_early: 0.324, pct_late: 0.441, pct_ontime: 0.235, pct_missed: 0 },
      ],
      routes: [],
      diagnostics: {
        configured: true, table_ready: true, service_month: "202609", record_count: 2,
        routes_below_target: 0, target: 0.85,
        flagged_threshold: threshold ?? 0.25,
        flagged_count: threshold === undefined ? 7 : 3,
      },
    }),
  ),
  getOtpMonthlyTrend: vi.fn().mockResolvedValue({ trend: [] }),
  getDateExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getStopExclusions: vi.fn().mockResolvedValue({ exclusions: [] }),
  getOtpAuditStream: vi.fn().mockResolvedValue({ entries: [] }),
  runOtpHistoricalBackfill: vi.fn().mockResolvedValue({
    service_month: "202605",
    otp_monthly: { reports_seen: 2612, upserted: 2612 },
    missed_trips: { reports_seen: 0, rows_inserted: 0 },
  }),
  // The measurement standard and the provenance of what is already stored
  // (ADR 0042). 2026-05 is one of the three months the OTP compliance
  // validation compares against the manual figure, and it still holds figures
  // polled under the spec-example parameters.
  getOtpMeasurementParameters: vi.fn().mockResolvedValue({
    in_force: {
      set: {
        early_threshold_minutes: 2, late_threshold_minutes: 5,
        early_outlier_minutes: 10, late_outlier_minutes: 60,
        show_missed_stops: 0, include_outliers: 1, show_detours: 1,
      },
      segments: "2/5/10/60/0/1/1",
      origin: "register",
      declaration: {
        id: "d2", effective_from: "2026-10-27", source: "Avail confirmation 2026-10-27",
        notes: null, declared_by: "ty@example.com", declared_at: "2026-10-27T15:00:00.000Z",
      },
    },
    history: [
      { id: "d2", effective_from: "2026-10-27", segments: "2/5/10/60/0/1/1", source: "Avail confirmation 2026-10-27", notes: null, declared_by: "ty@example.com", declared_at: "2026-10-27T15:00:00.000Z", early_threshold_minutes: 2, late_threshold_minutes: 5, early_outlier_minutes: 10, late_outlier_minutes: 60, show_missed_stops: 0, include_outliers: 1, show_detours: 1 },
      { id: "d1", effective_from: "2026-01-01", segments: "1/5/15/30/0/1/1", source: "Avail API specification example - not MVTA's standard", notes: null, declared_by: "migration-151", declared_at: "2026-10-27T15:00:00.000Z", early_threshold_minutes: 1, late_threshold_minutes: 5, early_outlier_minutes: 15, late_outlier_minutes: 30, show_missed_stops: 0, include_outliers: 1, show_detours: 1 },
    ],
    provenance: [
      { service_month: "202610", segments: "2/5/10/60/0/1/1", rows: 2700, first_stored_at: "2026-10-01T00:00:00.000Z", last_stored_at: "2026-10-27T00:00:00.000Z" },
      { service_month: "202605", segments: "1/5/15/30/0/1/1", rows: 2612, first_stored_at: "2026-05-01T00:00:00.000Z", last_stored_at: "2026-06-02T00:00:00.000Z" },
    ],
    needs_repull: [
      {
        service_month: "202605",
        stale: [{ service_month: "202605", segments: "1/5/15/30/0/1/1", rows: 2612, first_stored_at: "2026-05-01T00:00:00.000Z", last_stored_at: "2026-06-02T00:00:00.000Z" }],
        rows_in_force: 0,
        rows_unrecorded: 0,
      },
    ],
  }),
  declareOtpMeasurementParameters: vi.fn(),
} }));


describe("OTP compliance administration", () => {
  afterEach(cleanup);

  it("hosts the reason codes, threshold tuner, and backfill in the Administration workspace", async () => {
    render(<OtpComplianceAdmin />);

    expect(await screen.findByText("Stop exclusion reason codes")).toBeInTheDocument();
    expect(screen.getByText("Date exclusion reason codes")).toBeInTheDocument();
    expect(screen.getByText("Missed Trips reason codes")).toBeInTheDocument();
    expect(screen.getByText("Threshold tuner")).toBeInTheDocument();
    expect(screen.getByText("Historical data backfill")).toBeInTheDocument();
    expect(screen.getByText("OTP measurement standard")).toBeInTheDocument();
  });

  // ADR 0042: the standard in force is shown in minutes with its provenance,
  // because "2/5/10/60/0/1/1" explains nothing and a figure nobody can trace
  // to a dated, sourced declaration is the state this replaced.
  it("shows the measurement standard in force with where it came from", async () => {
    render(<OtpComplianceAdmin />);

    // Twice over: once as what is in force, once in the append-only history.
    expect(await screen.findAllByText(/early 2 \/ late 5 min, outliers 10\/60 min/)).toHaveLength(2);
    expect(screen.getAllByText(/Avail confirmation 2026-10-27/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/In force from/).length).toBeGreaterThan(0);
    // And the set it replaced is still on the record, as what older figures
    // were polled under.
    // Twice again: in the re-pull list as what 2026-05 still holds, and in the
    // history as what was declared.
    expect(screen.getAllByText(/early 1 \/ late 5 min, outliers 15\/30 min/)).toHaveLength(2);
  });

  // The months that are not comparable with today's standard are named, with
  // the row counts, rather than left for somebody to work out - 2026-05 is one
  // of the three the manual comparison rests on.
  it("names the months polled under a different standard, and offers to re-pull one", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { runOtpHistoricalBackfill: ReturnType<typeof vi.fn> };
    };
    api.runOtpHistoricalBackfill.mockClear();
    render(<OtpComplianceAdmin />);

    expect(await screen.findByText("Months measured under a different standard")).toBeInTheDocument();
    expect(screen.getByText("05/2026")).toBeInTheDocument();
    expect(screen.getByText("2,612")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Re-pull" }));
    expect(api.runOtpHistoricalBackfill).toHaveBeenCalledWith({ month: "202605" });
  });

  // A month Avail sends two records for on one key used to lose one of them
  // without a word (2026-03, 855 departures). The panel that re-pulls months is
  // where that has to show up.
  it("says when a month came back with two records on one key", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { runOtpHistoricalBackfill: ReturnType<typeof vi.fn> };
    };
    api.runOtpHistoricalBackfill.mockResolvedValueOnce({
      service_month: "202603",
      otp_monthly: {
        reports_seen: 1108,
        upserted: 1081,
        duplicate_keys: 27,
        duplicate_key_detail: [
          "202603 route 497 stop 31780 Mon: 2 records on one key (total=34/ontime=29 vs total=54/ontime=51), summed; differing fields: Total=34|54",
        ],
      },
      missed_trips: { reports_seen: 0, rows_inserted: 0 },
    });
    render(<OtpComplianceAdmin />);

    expect(await screen.findByText("Historical data backfill")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backfill" }));

    expect(await screen.findByText(/27 keys carried more than one record/)).toBeInTheDocument();
    expect(screen.getByText(/route 497 stop 31780 Mon/)).toBeInTheDocument();
  });

  // A key Avail stopped returning leaves the month's figure, which is a move
  // nobody asked for and will ask about. The panel that caused it says so.
  it("says which keys left the month, and when none were retired", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { runOtpHistoricalBackfill: ReturnType<typeof vi.fn> };
    };
    api.runOtpHistoricalBackfill
      .mockResolvedValueOnce({
        service_month: "202609",
        otp_monthly: {
          reports_seen: 860,
          upserted: 859,
          retired_keys: 1,
          retired_key_detail: [
            "202609: route 499 at Shakopee Walmart (stop 31967) on Thur - 17 departures, 17 on time, measured under no recorded standard - retired, Avail no longer returns it",
          ],
        },
        missed_trips: { reports_seen: 0, rows_inserted: 0 },
      })
      .mockResolvedValueOnce({
        service_month: "202610",
        otp_monthly: {
          reports_seen: 120,
          upserted: 120,
          retired_keys: 0,
          retirement_note:
            "758 of 878 stored keys were absent, but the payload accounted for only 13.7% of the month (needs 90%) - too short a delivery to tell a shrunken month from a bad response, so nothing was retired",
        },
        missed_trips: { reports_seen: 0, rows_inserted: 0 },
      });
    render(<OtpComplianceAdmin />);

    expect(await screen.findByText("Historical data backfill")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backfill" }));

    expect(await screen.findByText(/1 key Avail no longer returns was retired/)).toBeInTheDocument();
    expect(screen.getByText(/route 499 at Shakopee Walmart/)).toBeInTheDocument();
    // The refusal is the one an admin has to act on, so it says what to do.
    expect(screen.getByText(/too short a delivery/)).toBeInTheDocument();
    expect(screen.getByText(/checking with Avail/)).toBeInTheDocument();
  });

  // The hazard the ADR is answering: an admin control that silently restates
  // years of contractual performance. Declaring takes a stated source and a
  // confirmation that spells the consequence out first.
  it("will not declare a standard without a source, or without confirming first", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { declareOtpMeasurementParameters: ReturnType<typeof vi.fn> };
    };
    api.declareOtpMeasurementParameters.mockClear();
    render(<OtpComplianceAdmin />);

    fireEvent.click(await screen.findByRole("button", { name: "Declare a new standard" }));
    // No source yet, so the only way forward is disabled.
    expect(screen.getByRole("button", { name: "Review and declare" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. Avail confirmation 2026-10-27"), {
      target: { value: "Avail confirmation 2026-11-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review and declare" }));

    // Still nothing sent: the confirmation names the consequence first.
    expect(api.declareOtpMeasurementParameters).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing is re-pulled/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Declare 2/5/10/60/0/1/1" }));
    expect(api.declareOtpMeasurementParameters).toHaveBeenCalledWith({
      early_threshold_minutes: 2, late_threshold_minutes: 5,
      early_outlier_minutes: 10, late_outlier_minutes: 60,
      show_missed_stops: 0, include_outliers: 1, show_detours: 1,
      effective_from: expect.any(String),
      source: "Avail confirmation 2026-11-01",
      notes: null,
    });
  });

  // The saved threshold lands after this page mounts, so the slider has to
  // follow it - the built-in fallback is 15%, and the mock saves 25%.
  it("seeds the tuner slider from the saved threshold, not the built-in default", async () => {
    render(<OtpComplianceAdmin />);

    // "Currently applied" renders straight from the fetched threshold, but the
    // slider follows it from an effect, so it is still showing the 15% default
    // in the commit that first paints "Currently applied (25%)". Reading the
    // slider synchronously off the back of that await is a race - it passed
    // only when the effect's re-render happened to flush inside the findBy
    // poll. Await the seeded values themselves; the point of the test is that
    // they arrive at all.
    expect(await screen.findByText("Currently applied (25%)")).toBeInTheDocument();
    expect(await screen.findByText("Preview threshold: 25.0%")).toBeInTheDocument();
    expect(await screen.findByText("At preview threshold (25.0%)")).toBeInTheDocument();
  });

  it("asks the server for the count at a trial threshold instead of working it out here", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { getOtpMonthly: ReturnType<typeof vi.fn> };
    };
    api.getOtpMonthly.mockClear();
    render(<OtpComplianceAdmin />);

    // The count in force comes from a call with no threshold, so the server
    // applies the stored one.
    await screen.findByText("Currently applied (25%)");
    await vi.waitFor(() =>
      expect(api.getOtpMonthly.mock.calls).toContainEqual([expect.any(String)]),
    );
    expect(await screen.findByText("7")).toBeInTheDocument();

    // Moving the slider asks again, with the trial value - it is never
    // re-derived in the browser (ADR 0034).
    fireEvent.change(await screen.findByRole("slider"), { target: { value: "40" } });
    await vi.waitFor(
      () => expect(api.getOtpMonthly.mock.calls).toContainEqual([expect.any(String), 0.4]),
      { timeout: 2000 },
    );
    expect(await screen.findByText("At preview threshold (40.0%)")).toBeInTheDocument();
  });

  it("no longer offers Administration or Threshold Tuner inside the OTP module", async () => {
    render(<AppDialogProvider><OtpModule /></AppDialogProvider>);

    expect(await screen.findByRole("button", { name: "Review Queue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Threshold Tuner" })).not.toBeInTheDocument();
  });
});
