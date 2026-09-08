import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppDialogProvider } from "../components/AppDialog.js";
import { PerformanceStandardsAdmin } from "./PerformanceStandardsAdmin.js";

let roles: string[] = ["OCC.Admin"];
vi.mock("../auth/AuthContext.js", () => ({ useAuth: () => ({ roles }) }));

const AGREEMENT = {
  id: "a0000000-0000-4000-8000-000000000001", contractor_id: "c0000000-0000-4000-8000-000000000001",
  contractor_name: "Transit Operator", starts_on: "20250101", ends_on: "20291231",
  validation_business_days: 5, retention_years: 7, is_active: true, scored_standard_count: 2,
};
const OTP = {
  id: "50000000-0000-4000-8000-000000000001", code: "OTP_FIXED_ROUTE", name: "On-Time Performance (Fixed Route)",
  standard_type: "threshold" as const, priority: "High" as const, is_scored: true, is_safety_critical: false,
  direction: "higher_is_better" as const, unit_label: "percent", measurement_source: "api_feed" as const,
  resolver_key: "OTP_FIXED_ROUTE", sort_order: 26, effective_start_date: "20250101", effective_end_date: null,
};
const ORPHAN = {
  ...OTP, id: "50000000-0000-4000-8000-000000000002", code: "FLEET_AVAIL_SHORT", name: "Fleet Availability Short-Term",
  resolver_key: null, sort_order: 22,
};
const TIERS = [
  { id: "t1", standard_id: OTP.id, agreement_id: null, tier_order: 1, tier_label: "meets" as const, bound_low: 0.85, bound_high: null, qualifier_code: null, penalty_basis: "none" as const, penalty_amount: 0, triggers_cap: false, notes: null, effective_start_date: "20250101", effective_end_date: null },
  { id: "t2", standard_id: OTP.id, agreement_id: null, tier_order: 3, tier_label: "tier1" as const, bound_low: 0.75, bound_high: 0.8, qualifier_code: null, penalty_basis: "flat" as const, penalty_amount: 1500, triggers_cap: false, notes: null, effective_start_date: "20250101", effective_end_date: null },
];

const RESOLVERS = [
  { key: "OTP_FIXED_ROUTE", label: "Avail monthly on-time performance", description: "Fixed-route departures from Avail's monthly OTP feed.", applies_to: "threshold" as const, source: "api_feed" as const },
  { key: "MISSED_TRIPS_FR", label: "Confirmed missed trips", description: "Occurrences raised from MonitoredMissedTrips once confirmed.", applies_to: "occurrence" as const, source: "onboard_compliance" as const },
];

const SOURCE_SYSTEMS = [
  { value: "Nexus", label: "Nexus (Trackit)", description: "Customer contacts and operator conduct complaints." },
  { value: "Asset Works M5", label: "Asset Works M5", description: "Fleet maintenance, road calls and vehicle availability." },
];

const putAgreementStandards = vi.fn().mockResolvedValue({ id: AGREEMENT.id, assignment_count: 1 });
const putPerformanceStandard = vi.fn().mockResolvedValue({ id: OTP.id });
const deletePerformanceStandard = vi.fn();
const putReferenceValue = vi.fn().mockResolvedValue({ id: "r1" });
const deleteReferenceValue = vi.fn().mockResolvedValue({ id: "r1" });

// The lists behind the pickers, as migration 105 seeds them.
const REFERENCE_VALUES = [
  { id: "r-unit-pct", domain: "unit", value: "percent", label: "Percent (%)", description: null, sort_order: 1, severity_order: null, is_active: true, is_system: false },
  { id: "r-unit-occ", domain: "unit", value: "occurrences", label: "Occurrences", description: null, sort_order: 2, severity_order: null, is_active: true, is_system: false },
  { id: "r-cond-last", domain: "condition_code", value: "LAST_TRIP_OF_DAY", label: "Last trip of the service day", description: null, sort_order: 1, severity_order: null, is_active: true, is_system: false },
  { id: "r-tier-meets", domain: "tier_label", value: "meets", label: "Meets the standard", description: null, sort_order: 1, severity_order: 0, is_active: true, is_system: true },
  { id: "r-tier-1", domain: "tier_label", value: "tier1", label: "Tier 1 penalty", description: null, sort_order: 3, severity_order: 2, is_active: true, is_system: true },
  { id: "r-basis-flat", domain: "penalty_basis", value: "flat", label: "Flat amount for the month", description: "Charged once.", sort_order: 2, severity_order: null, is_active: true, is_system: true },
];
const putStandardTiers = vi.fn().mockResolvedValue({ standard_id: OTP.id, agreement_id: null, effective_start_date: "20260101", tier_count: 2 });

let catalog: Record<string, unknown>;
let referenceValues: { values: unknown[]; diagnostics?: { table_ready: boolean } };
vi.mock("../config.js", () => ({ api: {
  getPerformanceStandards: () => Promise.resolve(catalog),
  getContractors: () => Promise.resolve({ contractors: [{ id: "c0000000-0000-4000-8000-000000000001", name: "Transit Operator", contract_start_date: "20250101", contract_end_date: null, is_active: true }], diagnostics: { table_ready: true } }),
  putAgreementStandards: (...args: unknown[]) => putAgreementStandards(...args),
  putPerformanceStandard: (...args: unknown[]) => putPerformanceStandard(...args),
  putStandardTiers: (...args: unknown[]) => putStandardTiers(...args),
  deletePerformanceStandard: (...args: unknown[]) => deletePerformanceStandard(...args),
  getReferenceValues: () => Promise.resolve(referenceValues),
  putReferenceValue: (...args: unknown[]) => putReferenceValue(...args),
  deleteReferenceValue: (...args: unknown[]) => deleteReferenceValue(...args),
  putPerformanceAgreement: vi.fn().mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001" }),
} }));

const view = () => render(<MemoryRouter><AppDialogProvider><PerformanceStandardsAdmin /></AppDialogProvider></MemoryRouter>);

// Rows are chosen by name now - the code is an identifier, not something a
// reader scans for - so tests name the standard they mean and this maps the
// code they refer to it by.
const NAMES: Record<string, string> = {
  OTP_FIXED_ROUTE: "On-Time Performance (Fixed Route)",
  FLEET_AVAIL_SHORT: "Fleet Availability Short-Term",
  MISSED_TRIPS_FR: "Missed Trips",
};

async function open(code: string, tab?: "Details" | "Penalty bands" | "Assignment") {
  fireEvent.click(await screen.findByText(NAMES[code] ?? code));
  if (tab) fireEvent.click(screen.getByRole("button", { name: tab }));
}

describe("Performance Standards administration", () => {
  beforeEach(() => {
    roles = ["OCC.Admin"];
    referenceValues = { values: REFERENCE_VALUES, diagnostics: { table_ready: true } };
    catalog = {
      standards: [ORPHAN, OTP], tiers: TIERS, agreements: [AGREEMENT], resolvers: RESOLVERS, source_systems: SOURCE_SYSTEMS,
      assignments: [{ id: "g1", agreement_id: AGREEMENT.id, standard_id: OTP.id, is_scored: true, effective_start_date: "20250101", effective_end_date: null, assignment_note: null }],
      diagnostics: { table_ready: true, assignments_ready: true },
    };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("describes a standard in the list rather than showing its code", async () => {
    catalog = { ...catalog, standards: [ORPHAN, { ...OTP, description: "Departure adherence across all fixed routes, measured against the monthly Avail feed." }] };
    view();
    const row = (await screen.findByText("On-Time Performance (Fixed Route)")).closest("button")!;
    // The code is an identifier for resolvers and SQL, not something a reader
    // scanning the catalog needs.
    expect(within(row).queryByText("OTP_FIXED_ROUTE")).not.toBeInTheDocument();
    expect(within(row).getByText(/Departure adherence across all fixed routes/)).toBeInTheDocument();
    expect(within(row).getByText("Scored")).toBeInTheDocument();
    expect(within(row).getByText(/Monthly value · from a feed/)).toBeInTheDocument();
  });

  it("carries the whole description on hover, however long it is", async () => {
    // The row clamps to two lines so one long description cannot set the
    // height of every row; the title attribute keeps the rest reachable.
    const description = "Departure adherence across all fixed routes, measured against the monthly Avail feed, excluding special-event service and any stop exclusion an approver has signed off.";
    catalog = { ...catalog, standards: [{ ...OTP, description }] };
    view();
    const row = (await screen.findByText("On-Time Performance (Fixed Route)")).closest("button")!;
    expect(within(row).getByTitle(description)).toBeInTheDocument();
  });

  it("says when a standard has no description yet rather than showing a blank row", async () => {
    // Every one of the 26 seeded standards is currently in this state:
    // migration 030 never populated the column.
    view();
    const row = (await screen.findByText("On-Time Performance (Fixed Route)")).closest("button")!;
    expect(within(row).getByText("No description yet")).toBeInTheDocument();
  });

  it("keeps the code on the detail header, where the standard is named", async () => {
    view();
    await open("OTP_FIXED_ROUTE");
    const detail = document.querySelector(".standards-detail-head")!;
    expect(within(detail as HTMLElement).getByText("OTP_FIXED_ROUTE")).toHaveClass("mono-ref");
  });

  it("still finds a standard by code when searching", async () => {
    // Searching by code stays useful even though the row does not show one.
    view();
    await screen.findByText("On-Time Performance (Fixed Route)");
    fireEvent.change(screen.getByLabelText("Search standards"), { target: { value: "OTP_FIXED" } });
    expect(screen.getByText("On-Time Performance (Fixed Route)")).toBeInTheDocument();
    expect(screen.queryByText("Fleet Availability Short-Term")).not.toBeInTheDocument();
  });

  it("keeps the list and the detail in their own scroll areas", async () => {
    // The complaint this layout answers: the editor used to be stacked under
    // the catalog, so selecting a standard pushed it off the bottom.
    view();
    await open("OTP_FIXED_ROUTE");
    expect(document.querySelector(".standards-workspace")).toBeInTheDocument();
    expect(document.querySelector(".standards-list")).toBeInTheDocument();
    expect(document.querySelector(".standards-detail")).toBeInTheDocument();
  });

  it("offers a submenu per standard rather than one long form", async () => {
    view();
    await open("OTP_FIXED_ROUTE");
    for (const tab of ["Details", "Penalty bands", "Assignment"]) {
      expect(screen.getByRole("button", { name: tab })).toBeInTheDocument();
    }
    // Details is where a click lands, so the pane is never empty.
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-current", "true");
  });

  it("shows the governing bands whichever section is open", async () => {
    // It is what an administrator opened the page to check; it should not
    // depend on which tab they happen to be in.
    view();
    await open("OTP_FIXED_ROUTE", "Assignment");
    expect(screen.getByText("75% to under 80% → $1,500 for the month")).toBeInTheDocument();
    expect(screen.getByText("85% or above → no penalty")).toBeInTheDocument();
  });

  it("filters the catalog by what a reader is looking for", async () => {
    view();
    await screen.findByText("On-Time Performance (Fixed Route)");
    fireEvent.change(screen.getByLabelText("Filter standards"), { target: { value: "unassigned" } });
    expect(screen.queryByText("On-Time Performance (Fixed Route)")).not.toBeInTheDocument();
    expect(screen.getByText("Fleet Availability Short-Term")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter standards"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search standards"), { target: { value: "on-time" } });
    expect(screen.getByText("On-Time Performance (Fixed Route)")).toBeInTheDocument();
    expect(screen.queryByText("Fleet Availability Short-Term")).not.toBeInTheDocument();
  });

  it("names an automated standard that has no resolver behind it", async () => {
    view();
    const row = (await screen.findByText("Fleet Availability Short-Term")).closest("button")!;
    expect(within(row).getByText(/no resolver/)).toBeInTheDocument();
  });

  it("assigns a standard to the Agreement, not to the agency at large", async () => {
    view();
    await open("FLEET_AVAIL_SHORT", "Assignment");
    fireEvent.click(screen.getByLabelText("Scored on this Agreement"));
    expect(putAgreementStandards).toHaveBeenCalledWith(AGREEMENT.id, [expect.objectContaining({
      standard_id: ORPHAN.id, is_scored: true, effective_start_date: "20250101",
    })]);
  });

  it("records unassignment as an end date rather than a deletion", async () => {
    // A month that already scored the standard has to keep resolving it.
    view();
    await open("OTP_FIXED_ROUTE", "Assignment");
    fireEvent.change(screen.getByLabelText(/Stopped after/), { target: { value: "2026-06-30" } });
    expect(putAgreementStandards).toHaveBeenCalledWith(AGREEMENT.id, [expect.objectContaining({
      effective_end_date: "20260630",
    })]);
  });

  it("adds a standard the catalog has never held", async () => {
    view();
    fireEvent.click(await screen.findByText("New standard"));
    fireEvent.change(screen.getByPlaceholderText("OPERATOR_CONDUCT"), { target: { value: "shelter cleaning" } });
    const name = screen.getByText("Name").closest("label")!;
    fireEvent.change(within(name).getByRole("textbox"), { target: { value: "Shelter cleaning compliance" } });
    fireEvent.click(screen.getByRole("button", { name: "Add standard" }));
    expect(putPerformanceStandard).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      // Typed lowercase with a space; the field is constrained to the shape
      // operational SQL matches on.
      code: "SHELTERCLEANING", name: "Shelter cleaning compliance", standard_type: "occurrence",
    }));
  });

  it("will not open bands or assignment for a standard that does not exist yet", async () => {
    view();
    fireEvent.click(await screen.findByText("New standard"));
    expect(screen.getByRole("button", { name: "Penalty bands" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Assignment" })).toBeDisabled();
  });

  it("deletes only after confirming, and only a standard nothing has scored", async () => {
    deletePerformanceStandard.mockResolvedValue({ id: ORPHAN.id, code: ORPHAN.code });
    view();
    await open("FLEET_AVAIL_SHORT");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Delete Fleet Availability Short-Term\?/)).toBeInTheDocument();
    // The dialog says what happens and what to do instead.
    expect(screen.getByText(/retire it with an end date instead/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete standard" }));
    await waitFor(() => expect(deletePerformanceStandard).toHaveBeenCalledWith(ORPHAN.id));
  });

  it("reports the references that blocked a delete", async () => {
    deletePerformanceStandard.mockRejectedValue(new Error("On-Time Performance (Fixed Route) has been assessed against and cannot be deleted: it is referenced by 4 assessment periods."));
    view();
    await open("OTP_FIXED_ROUTE");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete standard" }));
    expect(await screen.findByText(/referenced by 4 assessment periods/)).toBeInTheDocument();
  });

  it("offers retiring as the safe alternative, prefilled with today", async () => {
    view();
    await open("OTP_FIXED_ROUTE");
    fireEvent.click(screen.getByRole("button", { name: "Retire…" }));
    const retired = screen.getByLabelText("Retired after") as HTMLInputElement;
    expect(retired.value).toBe(new Date().toISOString().slice(0, 10));
  });

  it("picks what measures a standard from the registry, not from a text box", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Details");
    expect(screen.getByLabelText(/Measured by/)).toHaveValue("OTP_FIXED_ROUTE");
    expect(screen.getByText(/Fixed-route departures from Avail/)).toBeInTheDocument();
  });

  it("offers only the resolvers that can serve this kind of standard", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Details");
    const options = within(screen.getByLabelText(/Measured by/)).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Avail monthly on-time performance");
    expect(options).not.toContain("Confirmed missed trips");
  });

  it("offers the four ways a figure actually arrives", async () => {
    view();
    fireEvent.click(await screen.findByText("New standard"));
    // Cards rather than a dropdown: each option shows the consequence of
    // picking it, so the choice is not hidden behind a closed select.
    const group = screen.getByRole("group", { name: "Where the figure comes from" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual([
      "manual_entry", "structured_import", "api_feed", "onboard_compliance",
    ]);
    expect(within(group).getByText("Somebody types the month's figure in.")).toBeInTheDocument();
  });

  it("asks which system a transcribed figure comes from, and will not save without it", async () => {
    // The difference between this and plain manual entry is provenance: it
    // names who to chase when the month's figure is missing.
    view();
    fireEvent.click(await screen.findByText("New standard"));
    fireEvent.click(screen.getByRole("radio", { name: /Transcribed from another system/ }));
    const system = screen.getByLabelText(/Source system/);
    expect(within(system).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Select the system…", "Nexus (Trackit)", "Asset Works M5", "Another system…"]);
    expect(screen.getByRole("button", { name: "Add standard" })).toBeDisabled();

    fireEvent.change(system, { target: { value: "Nexus" } });
    expect(screen.getByText(/operator conduct complaints/i)).toBeInTheDocument();
  });

  it("clears the fields a source kind does not use when it changes", async () => {
    // A leftover resolver on a hand-entered standard reads as automated to
    // anyone scanning the catalog, and the server refuses it anyway.
    view();
    await open("OTP_FIXED_ROUTE", "Details");
    expect(screen.getByLabelText(/Measured by/)).toHaveValue("OTP_FIXED_ROUTE");
    fireEvent.click(screen.getByRole("radio", { name: /Entered by hand/ }));
    expect(screen.queryByLabelText(/Measured by/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save standard" }));
    expect(putPerformanceStandard).toHaveBeenCalledWith(OTP.id, expect.objectContaining({
      measurement_source: "manual_entry", resolver_key: null, source_system: null,
    }));
  });

  it("offers only resolvers belonging to the chosen source kind", async () => {
    // A feed the app ingests and occurrences OnBoard raises itself used to be
    // the same value; MISSED_TRIPS_FR must not be offered as a feed.
    view();
    await open("OTP_FIXED_ROUTE", "Details");
    fireEvent.click(screen.getByRole("radio", { name: /Raised by OnBoard compliance/ }));
    expect(screen.getByText(/Nothing registered serves a monthly-value standard from this source/)).toBeInTheDocument();
  });

  it("hides the resolver picker entirely for a hand-entered standard", async () => {
    view();
    fireEvent.click(await screen.findByText("New standard"));
    expect(screen.queryByLabelText(/Measured by/)).not.toBeInTheDocument();
  });

  it("keeps a standard's code fixed once operational SQL can reference it", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Details");
    expect(screen.getByPlaceholderText("OPERATOR_CONDUCT")).toBeDisabled();
  });

  it("edits a band by criteria rather than by two unlabelled bounds", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    const criteria = screen.getAllByLabelText("Applies when the value is");
    expect(criteria[0]).toHaveValue("at_or_above");
    expect(criteria[1]).toHaveValue("between");
    // bound_high is exclusive, and two boxes labelled From and To never said so.
    expect(screen.getAllByLabelText(/Up to, not including/)[0]).toBeInTheDocument();
  });

  it("clears the bound a criteria change stops using", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    fireEvent.change(screen.getAllByLabelText("Applies when the value is")[1], { target: { value: "at_or_above" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    const ladder = putStandardTiers.mock.calls[0][1] as { tiers: { bound_low: number | null; bound_high: number | null }[] };
    // The 75-80% band becomes "75% or above": the low bound it had is kept,
    // the upper one it no longer uses is cleared.
    expect(ladder.tiers[1].bound_high).toBeNull();
    expect(ladder.tiers[1].bound_low).toBeCloseTo(0.75);
  });

  it("writes a tier ladder as a new dated version", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    const effective = screen.getByText("Effective from", { selector: ".standards-scope span" }).closest("label")!;
    fireEvent.change(within(effective).getByDisplayValue(/\d{4}-\d{2}-\d{2}/), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    expect(putStandardTiers).toHaveBeenCalledWith(OTP.id, expect.objectContaining({
      agreement_id: null, effective_start_date: "20260701",
    }));
  });

  it("writes percentage bands back as the ratios the resolvers compute", async () => {
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    // The number field and its slider both read 85, so target the number one.
    const number = screen.getAllByRole("textbox").find((input) => (input as HTMLInputElement).value === "85")!;
    fireEvent.change(number, { target: { value: "88" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    const ladder = putStandardTiers.mock.calls[0][1] as { tiers: { bound_low: number | null }[] };
    expect(ladder.tiers[0].bound_low).toBeCloseTo(0.88);
  });

  it("pairs a percentage bound with a slider, and leaves other units alone", async () => {
    // A percentage runs 0-100 on a shared scale and Attachment G's thresholds
    // sit on round numbers, so dragging is genuinely faster. Miles between road
    // calls has no such scale - a 0-100 track would be meaningless there.
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
    fireEvent.change(sliders[0], { target: { value: "90" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    const ladder = putStandardTiers.mock.calls[0][1] as { tiers: { bound_low: number | null }[] };
    expect(ladder.tiers[0].bound_low).toBeCloseTo(0.9);
  });

  it("gives a non-percentage bound no slider", async () => {
    const miles = { ...OTP, id: "50000000-0000-4000-8000-000000000009", code: "AVG_MILES_ROAD_CALLS", name: "Average Miles Between Road Calls", unit_label: "miles", measurement_source: "manual_entry" as const, resolver_key: null };
    catalog = { ...catalog, standards: [miles], tiers: [{ ...TIERS[1], standard_id: miles.id, bound_low: 10000, bound_high: 11000 }] };
    view();
    fireEvent.click(await screen.findByText("Average Miles Between Road Calls"));
    fireEvent.click(screen.getByRole("button", { name: "Penalty bands" }));
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("names a gap between bands before the ladder is saved", async () => {
    // Attachment G's own bands are not always contiguous, so this warns rather
    // than blocks - but an unintended gap scores a month at the wrong tier.
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    fireEvent.change(screen.getAllByLabelText(/From \(included\)/)[0], { target: { value: "60" } });
    expect(await screen.findByText(/Nothing scores between/)).toBeInTheDocument();
  });

  it("offers the condition codes the catalog uses, on standards that can match one", async () => {
    const occurrenceStandard = { ...ORPHAN, id: "50000000-0000-4000-8000-000000000003", code: "MISSED_TRIPS_FR", name: "Missed Trips", standard_type: "occurrence" as const, unit_label: "occurrences", resolver_key: "MISSED_TRIPS_FR" };
    catalog = {
      ...catalog, standards: [occurrenceStandard, OTP],
      tiers: [...TIERS, { ...TIERS[1], id: "t3", standard_id: occurrenceStandard.id, tier_order: 1, bound_low: null, bound_high: null, qualifier_code: "LAST_TRIP_OF_DAY" }],
    };
    view();
    await open("MISSED_TRIPS_FR", "Penalty bands");
    expect(screen.getAllByLabelText(/Condition/)[0]).toBeInTheDocument();
    expect(screen.getAllByText("Only when: Last trip of the service day").length).toBeGreaterThan(0);
  });

  it("offers no condition on a monthly-value standard, where one could never match", async () => {
    // assess.ts matches a threshold band with no qualifier, so a condition here
    // would build a band that silently never scores.
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    expect(screen.queryByLabelText(/Condition/)).not.toBeInTheDocument();
  });

  it("draws its pickers from the database, not from a literal list", async () => {
    // A tier renamed in the vocabulary shows that name in the band editor.
    referenceValues = {
      values: REFERENCE_VALUES.map((row) => row.value === "tier1" ? { ...row, label: "Level 1 Liquidated Damages" } : row),
      diagnostics: { table_ready: true },
    };
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    expect(screen.getAllByText("Level 1 Liquidated Damages").length).toBeGreaterThan(0);
    expect(screen.queryByText("Tier 1 penalty")).not.toBeInTheDocument();
  });

  it("falls back to its built-in lists before migration 105", async () => {
    // The page still renders every picker in an unmigrated environment.
    referenceValues = { values: [], diagnostics: { table_ready: false } };
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    expect(screen.getAllByText("Tier 1 penalty").length).toBeGreaterThan(0);
  });

  it("offers a condition the vocabulary defines, before any band uses it", async () => {
    // Conditions used to be derived from tiers that already carried one, so
    // the first band with a new condition could never be created here.
    const occurrenceStandard = { ...ORPHAN, id: "50000000-0000-4000-8000-000000000004", code: "MISSED_TRIPS_FR", name: "Missed Trips", standard_type: "occurrence" as const, unit_label: "occurrences", resolver_key: "MISSED_TRIPS_FR", measurement_source: "onboard_compliance" as const };
    catalog = { ...catalog, standards: [occurrenceStandard], tiers: [{ ...TIERS[1], standard_id: occurrenceStandard.id, bound_low: null, bound_high: null, qualifier_code: null }] };
    view();
    await open("MISSED_TRIPS_FR", "Penalty bands");
    expect(screen.getByText("Only when: Last trip of the service day")).toBeInTheDocument();
  });

  it("names the governing exhibit from the Agreement, not from the product", async () => {
    catalog = { ...catalog, agreements: [{ ...AGREEMENT, exhibit_reference: "Attachment G v2", contract_number: "RFP 2025-07" }] };
    view();
    expect(await screen.findByText("Attachment G v2")).toBeInTheDocument();
  });

  it("lets a non-administrator read the catalog but change nothing", async () => {
    roles = ["OCC.Compliance"];
    view();
    expect(await screen.findByText(/requires Administrator access/)).toBeInTheDocument();
    expect(screen.queryByText("New standard")).not.toBeInTheDocument();
    await open("OTP_FIXED_ROUTE");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("says plainly that no Agreement means no assessment can run", async () => {
    catalog = { ...catalog, agreements: [], assignments: [] };
    view();
    expect(await screen.findByText(/no assessment period can be opened/)).toBeInTheDocument();
  });

  it("degrades to a catalog-only view when migration 102 has not run", async () => {
    catalog = { ...catalog, agreements: [], assignments: [], diagnostics: { table_ready: true, assignments_ready: false } };
    view();
    expect(await screen.findByText(/Migration 102 has not been applied/)).toBeInTheDocument();
  });

  it("does not offer a band edit the write path would refuse before migration 102", async () => {
    catalog = { ...catalog, agreements: [], assignments: [], diagnostics: { table_ready: true, assignments_ready: false } };
    view();
    await open("OTP_FIXED_ROUTE", "Penalty bands");
    expect(screen.queryByText("Save penalty bands")).not.toBeInTheDocument();
    // The bands stay readable: the month's numbers can still be verified.
    // Twice by design - the always-visible summary, and the editor's readout.
    expect(screen.getAllByText("75% to under 80% → $1,500 for the month").length).toBe(2);
  });
});
