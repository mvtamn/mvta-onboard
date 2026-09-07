import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { type FixedRouteDeparture, type OnDemandDeparture } from "@mvta/shared";
import { GarageDepartures } from "./GarageDepartures.js";
import { dailyReviewable, groupDepartures, statusPill } from "./FixedRouteDepartures.js";
import { dailyFlagged, groupDuties } from "./OnDemandDepartures.js";
import { agencyTimeLabel, deltaMinutesLabel, operatorParts, serviceDayLabel, serviceDaysEnding, shortRef } from "./garageDepartures.shared.js";

// The departure views read roles to decide whether the reviewer may settle an
// occurrence from the row. These tests render the view directly, outside the
// app's provider tree, so the roles come from here.
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.Compliance"] }) }));


vi.mock("../../config.js", () => ({
  api: {
    getFixedRouteDepartures: vi.fn(),
    getOnDemandDepartures: vi.fn(),
    getKpiTrust: vi.fn().mockResolvedValue({ streams: {} }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Garage Departures", () => {
  it("shows fixed route first and reads on-demand only when that service is chosen", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({
      departures: [],
      diagnostics: { configured: true, table_ready: true, record_count: 0, settled_count: 0, late_count: 0, no_departure_count: 0, avg_delta_seconds: null, variance_seconds: 600, settled_before: "20260905" },
    });
    vi.mocked(api.getOnDemandDepartures).mockResolvedValue({
      departures: [],
      diagnostics: { configured: false, table_ready: false, record_count: 0, judged_count: 0, late_count: 0, no_departure_count: 0, avg_delta_seconds: null, variance_seconds: 600, settled_before: "20260905" },
    });

    render(<GarageDepartures />);

    expect(screen.getByRole("heading", { name: "Garage Departures" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Fixed route departures summary")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Fixed Route" })).toHaveAttribute("aria-selected", "true");
    // One source per service type: the on-demand feed is not consulted for
    // the fixed-route view, so its not-connected state cannot leak in.
    expect(api.getOnDemandDepartures).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "On-Demand" }));

    expect(await screen.findByLabelText("On-demand departures summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fixed route departures summary")).not.toBeInTheDocument();
    expect(await screen.findByText("Departure monitoring is not configured")).toBeInTheDocument();
    expect(screen.getByText(/Spare's start-location slot/)).toBeInTheDocument();
  });
});

// Fixed Route rows shaped like the API's, on an agency day that is settled
// (Sep 4) and one that is not (Sep 5, "today").
function fixedRow(overrides: Partial<FixedRouteDeparture>): FixedRouteDeparture {
  return {
    occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,

    service_date: "20260904",
    block: 1305,
    run: 2,
    checkin_scheduled: null,
    checkin_actual: null,
    login_scheduled: null,
    login_actual: null,
    pullout_scheduled: "2026-09-04T09:58:00Z",
    pullout_actual: "2026-09-04T10:16:00Z",
    pullout_status: "Expired Pullout",
    operator_name: "DELACROIX, AMIR -144",
    logon_id: 144,
    vehicle_label: "1922",
    updated_at: "2026-09-05T06:20:00Z",
    pullout_delta_seconds: 18 * 60,
    outcome: "late",
    ...overrides,
  };
}

const FIXED_ROWS: FixedRouteDeparture[] = [
  fixedRow({}),
  fixedRow({ block: 1118, run: 5, operator_name: "BRANNIGAN, COLE -302", logon_id: 302, vehicle_label: "1908", pullout_scheduled: "2026-09-04T11:05:00Z", pullout_actual: null, pullout_status: "Missed Pullout", pullout_delta_seconds: null, outcome: "no_departure" }),
  fixedRow({ block: 1412, run: 7, operator_name: "OKAFOR, DENISE -218", logon_id: 218, vehicle_label: "1934", pullout_actual: "2026-09-04T10:01:00Z", pullout_delta_seconds: 3 * 60, outcome: "departed" }),
  fixedRow({ service_date: "20260903", pullout_actual: "2026-09-03T10:11:00Z", pullout_status: "Late Pullout", pullout_delta_seconds: 13 * 60, outcome: "late" }),
  fixedRow({ service_date: "20260905", block: 1207, run: 3, operator_name: null, logon_id: null, vehicle_label: null, pullout_actual: null, pullout_status: null, pullout_delta_seconds: null, outcome: "not_settled" }),
];

const FIXED_DIAGNOSTICS = {
  configured: true, table_ready: true, record_count: 5, settled_count: 4, late_count: 2, no_departure_count: 1,
  avg_delta_seconds: 680, variance_seconds: 600, settled_before: "20260905",
};

describe("Fixed Route display helpers", () => {
  it("formats the service day and pullout times in the agency's zone", () => {
    expect(serviceDayLabel("20260904")).toBe("Fri, Sep 4, 2026");
    expect(serviceDayLabel("not-a-date")).toBe("not-a-date");
    // 09:58 UTC is 4:58 AM Central Daylight Time, whatever zone the browser is in.
    expect(agencyTimeLabel("2026-09-04T09:58:00Z")).toBe("4:58 AM");
    expect(agencyTimeLabel(null)).toBe("—");
  });

  it("enumerates the window's service days from the API's settled boundary", () => {
    expect(serviceDaysEnding("20260905", 3)).toEqual(["20260903", "20260904", "20260905"]);
    expect(serviceDaysEnding("20260901", 2)).toEqual(["20260831", "20260901"]);
  });

  it("splits Avail's LAST, FIRST -badge operator string into a readable name and a badge", () => {
    expect(operatorParts("DELACROIX, AMIR -144")).toEqual({ name: "Delacroix, Amir", badge: "144" });
    expect(operatorParts("O'BRIEN, MARY-ANNE -7")).toEqual({ name: "O'Brien, Mary-Anne", badge: "7" });
    expect(operatorParts("SMITH, JOHN")).toEqual({ name: "Smith, John", badge: null });
    expect(operatorParts("  ")).toBeNull();
    expect(operatorParts(null)).toBeNull();
  });

  it("labels deltas in signed minutes with a real minus, and zero as zero", () => {
    expect(deltaMinutesLabel(18 * 60)).toBe("+18 min");
    expect(deltaMinutesLabel(-2 * 60)).toBe("−2 min");
    expect(deltaMinutesLabel(20)).toBe("0 min");
    expect(deltaMinutesLabel(null)).toBe("—");
  });

  it("tints Avail's status by what it says about the departure", () => {
    expect(statusPill("Missed Pullout").className).toBe("pill-danger");
    expect(statusPill("Missed Login").className).toBe("pill-danger");
    expect(statusPill("Expired Pullout").className).toBe("pill-danger");
    expect(statusPill("Late Pullout").className).toBe("pill-warning");
    expect(statusPill("On Time Pullout").className).toBe("pill-muted");
    expect(statusPill(null)).toEqual({ label: "Still resolving", className: "pill-muted" });
  });

  it("groups by service day newest first, with the runs needing attention first inside a day", () => {
    const groups = groupDepartures(FIXED_ROWS, "date");
    expect(groups.map((g) => g.key)).toEqual(["20260905", "20260904", "20260903"]);
    expect(groups[0]).toMatchObject({ title: "Sat, Sep 5, 2026", settled: false });
    expect(groups[1]).toMatchObject({ settled: true, lateCount: 1, noDepartureCount: 1, departedCount: 2, avgDeltaSeconds: Math.round((18 * 60 + 3 * 60) / 2) });
    expect(groups[1].rows.map((r) => r.outcome)).toEqual(["no_departure", "late", "departed"]);
  });

  it("groups by operator with the most reviewable runs first and the badge as a reference", () => {
    const groups = groupDepartures(FIXED_ROWS, "operator");
    expect(groups[0]).toMatchObject({ title: "Delacroix, Amir", reference: "#144", lateCount: 2, noDepartureCount: 0 });
    expect(groups[0].rows.map((r) => r.service_date)).toEqual(["20260904", "20260903"]);
    expect(groups[1]).toMatchObject({ title: "Brannigan, Cole", reference: "#302", noDepartureCount: 1 });
    expect(groups.map((g) => g.title)).toContain("No operator on record");
  });

  it("groups by vehicle", () => {
    const groups = groupDepartures(FIXED_ROWS, "vehicle");
    expect(groups[0]).toMatchObject({ title: "Vehicle 1922", lateCount: 2 });
    expect(groups.map((g) => g.title)).toContain("No vehicle on record");
  });

  it("counts reviewable departures for every day in the window, quiet days included", () => {
    const daily = dailyReviewable(FIXED_ROWS, "20260905", 4);
    expect(daily.map((d) => d.date)).toEqual(["20260902", "20260903", "20260904", "20260905"]);
    expect(daily[0]).toEqual({ date: "20260902", late: 0, noDeparture: 0, settled: true });
    expect(daily[2]).toEqual({ date: "20260904", late: 1, noDeparture: 1, settled: true });
    expect(daily[3]).toMatchObject({ settled: false });
  });
});

describe("Fixed Route view", () => {
  it("renders the day band, the split operator, the fleet number, agency-local times and the judged outcome", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({ departures: FIXED_ROWS, diagnostics: FIXED_DIAGNOSTICS });

    render(<GarageDepartures />);

    expect(await screen.findByText("Fri, Sep 4, 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Delacroix, Amir", { exact: false }).length).toBe(2);
    expect(screen.getAllByText("#144").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1922").length).toBe(2);
    expect(screen.getAllByText("4:58 AM").length).toBeGreaterThan(0);
    expect(screen.getByText("5:16 AM")).toBeInTheDocument();
    expect(screen.getByText("+18 min")).toBeInTheDocument();
    // Avail's status is evidence; the outcome is the judgement, and both show.
    expect(screen.getByText("Missed Pullout")).toBeInTheDocument();
    expect(screen.getAllByText("No departure").length).toBeGreaterThan(0);
    expect(screen.getByText("Within allowance")).toBeInTheDocument();
    // Today's run is not judged, and its blanks are said in words.
    expect(screen.getByText("Still resolving")).toBeInTheDocument();
    expect(screen.getAllByText("Not settled").length).toBeGreaterThan(0);
    expect(screen.getByText("No operator on record")).toBeInTheDocument();
    expect(screen.getByText("No vehicle on record")).toBeInTheDocument();
    // The cards say what the counts are a share of, and the allowance is named.
    expect(screen.getAllByText("Late over 10 min").length).toBe(2); // the card and the strip legend
    expect(screen.getByText("25.0% of 4 settled runs")).toBeInTheDocument();
    expect(screen.getByText("4 settled · 1 today, not settled")).toBeInTheDocument();
    // The raw stored forms never reach the page.
    expect(screen.queryByText("20260904")).not.toBeInTheDocument();
    expect(screen.queryByText("DELACROIX, AMIR -144")).not.toBeInTheDocument();
  });

  it("regroups by operator and filters to reviewable runs", async () => {
    vi.mocked(api.getFixedRouteDepartures).mockResolvedValue({ departures: FIXED_ROWS, diagnostics: FIXED_DIAGNOSTICS });

    render(<GarageDepartures />);
    await screen.findByText("Fri, Sep 4, 2026");

    fireEvent.click(screen.getByRole("tab", { name: "Operator" }));
    expect(screen.getByText("Delacroix, Amir")).toBeInTheDocument();
    expect(screen.getByText("Repeat")).toBeInTheDocument();
    expect(screen.getByText("2 runs · 2 reviewable · avg +16 min")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "reviewable" } });
    expect(screen.queryByText("Within allowance")).not.toBeInTheDocument();
    expect(screen.queryByText("Okafor, Denise")).not.toBeInTheDocument();
    expect(screen.getAllByText("Late").length).toBeGreaterThan(0);
  });
});

function dutyRow(overrides: Partial<OnDemandDeparture>): OnDemandDeparture {
  return {
    occurrence_id: null, occurrence_review_status: null, occurrence_attribution: null,
    occurrence_service_month: null, occurrence_period_status: null,

    service_date: "20260904",
    duty_id: "a1",
    duty_identifier: "OD-2198",
    driver_id: "3f9a2c1e-7b40-4d1a-9e6c-0a1b2c3d4e5f",
    vehicle_id: "e5a1c3d7-2b4f-4a6c-9d8e-1f2a3b4c5d6e",
    vehicle_identifier: "1188",
    driver_name: "Delacroix, Amir",
    driver_identifier: "144",
    duty_status: "completed",
    departure_scheduled: "2026-09-04T11:00:00Z",
    scheduled_source: "slots_startLocation",
    departure_actual: "2026-09-04T11:17:00Z",
    departure_source: "slots_startLocation",
    updated_at: "2026-09-04T12:00:00Z",
    departure_delta_seconds: 17 * 60,
    no_departure: false,
    outcome: "late",
    ...overrides,
  };
}

const DUTY_ROWS: OnDemandDeparture[] = [
  dutyRow({}),
  dutyRow({ duty_id: "a2", duty_identifier: "OD-2199", driver_id: "c4e2a9f0-1d3b-4c5e-8f7a-9b0c1d2e3f4a", driver_name: null, driver_identifier: null, departure_actual: "2026-09-04T11:09:00Z", departure_delta_seconds: 9 * 60, outcome: "departed" }),
  dutyRow({ duty_id: "a3", duty_identifier: "OD-2203", driver_id: null, departure_actual: null, departure_source: null, departure_delta_seconds: null, no_departure: true, outcome: "no_departure" }),
  dutyRow({ service_date: "20260903", duty_id: "a4", duty_identifier: "OD-2180", departure_actual: "2026-09-03T11:22:00Z", departure_delta_seconds: 22 * 60, outcome: "late" }),
  dutyRow({ service_date: "20260905", duty_id: "a5", duty_identifier: "OD-2211", duty_status: "scheduled", departure_actual: null, departure_source: null, departure_delta_seconds: null, outcome: "not_settled" }),
  dutyRow({ duty_id: "a6", duty_identifier: "OD-2204", vehicle_id: "9c7b5a3d-1e2f-4c4b-8a6d-5e4f3a2b1c0d", vehicle_identifier: null, departure_actual: "2026-09-04T11:03:00Z", departure_delta_seconds: 3 * 60, outcome: "departed" }),
];

describe("On-Demand display helpers", () => {
  it("shortens a Spare id to a recognisable reference", () => {
    expect(shortRef("3f9a2c1e-7b40-4d1a-9e6c-0a1b2c3d4e5f")).toBe("3f9a2c1e…");
    expect(shortRef("  ")).toBeNull();
    expect(shortRef(null)).toBeNull();
  });

  it("groups duties by service day newest first, attention first inside a day, today marked open", () => {
    const groups = groupDuties(DUTY_ROWS, "date", "20260905");
    expect(groups.map((g) => g.key)).toEqual(["20260905", "20260904", "20260903"]);
    expect(groups[0]).toMatchObject({ title: "Sat, Sep 5, 2026", open: true });
    expect(groups[1]).toMatchObject({ open: false, lateCount: 1, noDepartureCount: 1, departedCount: 3, avgDeltaSeconds: Math.round((17 + 9 + 3) * 60 / 3) });
    expect(groups[1].rows.map((r) => r.outcome)).toEqual(["no_departure", "late", "departed", "departed"]);
  });

  it("groups duties by driver reference with the most flagged first", () => {
    const groups = groupDuties(DUTY_ROWS, "operator", "20260905");
    expect(groups[0]).toMatchObject({ title: "Delacroix, Amir", reference: "#144", lateCount: 2 });
    expect(groups.map((g) => g.title)).toContain("Driver c4e2a9f0…");
    expect(groups[0].rows.map((r) => r.service_date)).toEqual(["20260905", "20260904", "20260904", "20260903"]);
    expect(groups.map((g) => g.title)).toContain("No driver on duty");
  });

  it("groups duties by vehicle on the fleet number when Spare gave one, else the id", () => {
    const groups = groupDuties(DUTY_ROWS, "vehicle", "20260905");
    expect(groups[0]).toMatchObject({ title: "Vehicle 1188", reference: "e5a1c3d7-2b4f-4a6c-9d8e-1f2a3b4c5d6e" });
    expect(groups.map((g) => g.title)).toContain("Vehicle 9c7b5a3d…");
  });

  it("counts flagged duties per day in the window", () => {
    const daily = dailyFlagged(DUTY_ROWS, "20260905", 3);
    expect(daily).toEqual([
      { date: "20260903", late: 1, noDeparture: 0, settled: true },
      { date: "20260904", late: 1, noDeparture: 1, settled: true },
      { date: "20260905", late: 0, noDeparture: 0, settled: false },
    ]);
  });
});
