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
  // One phase per request, and a response that carries only the phase asked
  // for - a phase that did not run is absent, not zero.
  runOtpHistoricalBackfill: vi.fn().mockImplementation(({ month, phase }: { month: string; phase?: string }) =>
    Promise.resolve(
      phase === "missed_trips"
        ? { service_month: month, missed_trips: { reports_seen: 0, rows_inserted: 0 } }
        : { service_month: month, otp_monthly: { reports_seen: 2612, upserted: 2612 } },
    ),
  ),
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
    // The OTP phase alone: a re-pull has no business waiting on a Missed
    // Trips reload it never asked for.
    expect(api.runOtpHistoricalBackfill).toHaveBeenCalledWith({ month: "202605", phase: "otp_monthly" });
  });

  // The defect this shape exists to prevent, as seen on dev 2026-10-28: the
  // backfill reported "OTP Monthly - Request failed (504)" and 0 rows for
  // 202605 and 202606, both of which had been written in full, because the
  // OTP result rode back on a response the Missed Trips reload was still
  // holding open. Each phase is its own request now, so a Missed Trips
  // failure cannot be reported as an OTP one.
  it("reports a finished OTP phase even when the Missed Trips phase fails", async () => {
    const { api } = (await import("../config.js")) as unknown as {
      api: { runOtpHistoricalBackfill: ReturnType<typeof vi.fn> };
    };
    api.runOtpHistoricalBackfill.mockClear();
    api.runOtpHistoricalBackfill.mockImplementation(({ month, phase }: { month: string; phase?: string }) =>
      phase === "missed_trips"
        ? Promise.reject(new Error("504"))
        : Promise.resolve({ service_month: month, otp_monthly: { reports_seen: 2612, upserted: 2612 } }),
    );
    render(<OtpComplianceAdmin />);

    await screen.findByText("Historical data backfill");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-05" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Run backfill" }));

    expect(await screen.findByText(/2612 OTP Monthly rows upserted/)).toBeInTheDocument();
    expect(screen.getByText(/202605: Missed Trips - Request failed/)).toBeInTheDocument();
    expect(screen.queryByText(/OTP Monthly - Request failed/)).not.toBeInTheDocument();
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
