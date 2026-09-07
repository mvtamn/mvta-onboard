import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  direction: "higher_is_better" as const, unit_label: "percent", measurement_source: "auto" as const,
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

const putAgreementStandards = vi.fn().mockResolvedValue({ id: AGREEMENT.id, assignment_count: 1 });
const putPerformanceStandard = vi.fn().mockResolvedValue({ id: OTP.id });
const putStandardTiers = vi.fn().mockResolvedValue({ standard_id: OTP.id, agreement_id: null, effective_start_date: "20260101", tier_count: 2 });

let catalog: Record<string, unknown>;
vi.mock("../config.js", () => ({ api: {
  getPerformanceStandards: () => Promise.resolve(catalog),
  getContractors: () => Promise.resolve({ contractors: [{ id: "c0000000-0000-4000-8000-000000000001", name: "Transit Operator", contract_start_date: "20250101", contract_end_date: null, is_active: true }], diagnostics: { table_ready: true } }),
  putAgreementStandards: (...args: unknown[]) => putAgreementStandards(...args),
  putPerformanceStandard: (...args: unknown[]) => putPerformanceStandard(...args),
  putStandardTiers: (...args: unknown[]) => putStandardTiers(...args),
  putPerformanceAgreement: vi.fn().mockResolvedValue({ id: "a0000000-0000-4000-8000-000000000001" }),
} }));

describe("Performance Standards administration", () => {
  beforeEach(() => {
    roles = ["OCC.Admin"];
    catalog = {
      standards: [ORPHAN, OTP], tiers: TIERS, agreements: [AGREEMENT],
      assignments: [{ id: "g1", agreement_id: AGREEMENT.id, standard_id: OTP.id, is_scored: true, effective_start_date: "20250101", effective_end_date: null, assignment_note: null }],
      diagnostics: { table_ready: true, assignments_ready: true },
    };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("states each band as a sentence, not as two raw bounds", async () => {
    render(<PerformanceStandardsAdmin />);
    // The page this replaces showed "tier1 75…80: $1,500 flat", which leaves a
    // reader to work out which end is inclusive and what "flat" multiplies by.
    expect(await screen.findByText("75% to under 80% → $1,500 for the month")).toBeInTheDocument();
    expect(screen.getByText("85% or above → no penalty")).toBeInTheDocument();
    expect(screen.getByText("Tier 1 penalty")).toBeInTheDocument();
  });

  it("leads with the standard's name and keeps its code as a reference", async () => {
    render(<PerformanceStandardsAdmin />);
    const row = (await screen.findByText("On-Time Performance (Fixed Route)")).closest("tr")!;
    // The code still has to be findable - resolvers and operational SQL match
    // on it - but it is no longer the first thing a reader has to decode.
    expect(within(row).getByText("OTP_FIXED_ROUTE")).toHaveClass("mono-ref");
    expect(within(row).getByText("Monthly value")).toBeInTheDocument();
    expect(within(row).getByText(/percent · higher is better/)).toBeInTheDocument();
  });

  it("names an automated standard that has no resolver behind it", async () => {
    render(<PerformanceStandardsAdmin />);
    expect(await screen.findByText("no resolver")).toBeInTheDocument();
  });

  it("distinguishes a standard scored on this Agreement from one that is unassigned", async () => {
    render(<PerformanceStandardsAdmin />);
    expect(await screen.findByText("Scored")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("assigns a standard to the Agreement rather than to the agency at large", async () => {
    render(<PerformanceStandardsAdmin />);
    const row = (await screen.findByText("FLEET_AVAIL_SHORT")).closest("tr")!;
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(putAgreementStandards).toHaveBeenCalledWith(AGREEMENT.id, [expect.objectContaining({
      standard_id: ORPHAN.id, is_scored: true, effective_start_date: "20250101",
    })]);
  });

  it("adds a standard the catalog has never held", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("Add standard"));
    fireEvent.change(screen.getByPlaceholderText("OPERATOR_CONDUCT"), { target: { value: "shelter cleaning" } });
    const name = screen.getByText("Name").closest("label")!;
    fireEvent.change(within(name).getByRole("textbox"), { target: { value: "Shelter cleaning compliance" } });
    fireEvent.click(screen.getByText("Add standard", { selector: "button.btn-primary" }));
    expect(putPerformanceStandard).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      // Typed lowercase with a space; the field is constrained to the shape
      // operational SQL matches on.
      code: "SHELTERCLEANING", name: "Shelter cleaning compliance", standard_type: "occurrence",
    }));
  });

  it("refuses to save an automated standard with no resolver key", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("FLEET_AVAIL_SHORT"));
    expect(screen.getByText("Save standard", { selector: "button" })).toBeDisabled();
  });

  it("keeps a standard's code fixed once operational SQL can reference it", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    expect(screen.getByPlaceholderText("OPERATOR_CONDUCT")).toBeDisabled();
  });

  it("writes a tier ladder as a new dated version", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    const effective = screen.getByText("Effective from", { selector: ".standards-scope span" }).closest("label")!;
    fireEvent.change(within(effective).getByDisplayValue(/\d{4}-\d{2}-\d{2}/), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    expect(putStandardTiers).toHaveBeenCalledWith(OTP.id, expect.objectContaining({
      agreement_id: null, effective_start_date: "20260701",
    }));
  });

  it("writes percentage bands back as the ratios the resolvers compute", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    fireEvent.change(screen.getByDisplayValue("85"), { target: { value: "88" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    const ladder = putStandardTiers.mock.calls[0][1] as { tiers: { bound_low: number | null }[] };
    expect(ladder.tiers[0].bound_low).toBeCloseTo(0.88);
  });

  it("edits a band by criteria rather than by two unlabelled bounds", async () => {
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    const criteria = screen.getAllByLabelText("Applies when the value is");
    // The seeded OTP ladder: 85%+ meets, 75-80 is tier 1.
    expect(criteria[0]).toHaveValue("at_or_above");
    expect(criteria[1]).toHaveValue("between");
    // "Up to, not including" is the whole point - bound_high is exclusive, and
    // two boxes labelled From and To never said so.
    expect(screen.getAllByLabelText(/Up to, not including/)[0]).toBeInTheDocument();
  });

  it("clears the bound a criteria change stops using", async () => {
    // A leftover upper bound would keep narrowing a band the administrator
    // believes they widened to everything at or above a number.
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    const criteria = screen.getAllByLabelText("Applies when the value is");
    fireEvent.change(criteria[1], { target: { value: "at_or_above" } });
    fireEvent.click(screen.getByText("Save penalty bands"));
    const ladder = putStandardTiers.mock.calls[0][1] as { tiers: { bound_low: number | null; bound_high: number | null }[] };
    // The 75-80% band becomes "75% or above": the low bound it already had is
    // kept, the upper one it no longer uses is cleared.
    expect(ladder.tiers[1].bound_high).toBeNull();
    expect(ladder.tiers[1].bound_low).toBeCloseTo(0.75);
  });

  it("offers the condition codes the catalog already uses, on the standards that can match one", async () => {
    // A free-text qualifier that matches no occurrence scores nothing, silently.
    const occurrenceStandard = { ...ORPHAN, id: "50000000-0000-4000-8000-000000000003", code: "MISSED_TRIPS_FR", name: "Missed Trips", standard_type: "occurrence" as const, unit_label: "occurrences", resolver_key: "MISSED_TRIPS_FR" };
    catalog = {
      ...catalog, standards: [occurrenceStandard, OTP],
      tiers: [...TIERS, { ...TIERS[1], id: "t3", standard_id: occurrenceStandard.id, tier_order: 1, bound_low: null, bound_high: null, qualifier_code: "LAST_TRIP_OF_DAY" }],
    };
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("MISSED_TRIPS_FR"));
    expect(screen.getAllByLabelText(/Condition/)[0]).toBeInTheDocument();
    expect(screen.getAllByText("Only when: Last trip of day").length).toBeGreaterThan(0);
  });

  it("offers no condition on a monthly-value standard, where one could never match", async () => {
    // assess.ts matches a threshold band with no qualifier, and matchTier then
    // considers unqualified bands only - so a condition here would build a band
    // that silently never scores.
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    expect(screen.queryByLabelText(/Condition/)).not.toBeInTheDocument();
  });

  it("names a gap between bands before the ladder is saved", async () => {
    // Attachment G's own bands are not always contiguous, so this warns rather
    // than blocks - but an unintended gap scores a month at the wrong tier.
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    fireEvent.change(screen.getAllByLabelText(/From \(included\)/)[0], { target: { value: "60" } });
    expect(await screen.findByText(/Nothing scores between/)).toBeInTheDocument();
  });

  it("lets a non-administrator read the catalog but change nothing", async () => {
    roles = ["OCC.Compliance"];
    render(<PerformanceStandardsAdmin />);
    expect(await screen.findByText(/requires Administrator access/)).toBeInTheDocument();
    expect(screen.queryByText("Add standard")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
  });

  it("says plainly that no Agreement means no assessment can run", async () => {
    catalog = { ...catalog, agreements: [], assignments: [] };
    render(<PerformanceStandardsAdmin />);
    expect(await screen.findByText(/no assessment period can be opened/)).toBeInTheDocument();
  });

  it("degrades to a catalog-only view when migration 102 has not run", async () => {
    catalog = { ...catalog, agreements: [], assignments: [], diagnostics: { table_ready: true, assignments_ready: false } };
    render(<PerformanceStandardsAdmin />);
    expect(await screen.findByText(/Migration 102 has not been applied/)).toBeInTheDocument();
  });

  it("does not offer a tier edit the write path would refuse before migration 102", async () => {
    // Tier rows carry their scope in a column that migration adds, so the
    // server 409s. Offering the button anyway would make the warning banner
    // look advisory.
    catalog = { ...catalog, agreements: [], assignments: [], diagnostics: { table_ready: true, assignments_ready: false } };
    render(<PerformanceStandardsAdmin />);
    fireEvent.click(await screen.findByText("OTP_FIXED_ROUTE"));
    expect(screen.queryByText("Save penalty bands")).not.toBeInTheDocument();
    // The bands stay readable - the point is that the month's numbers can
    // still be verified, only not changed. The sentence appears twice by
    // design: once in the catalog row, once as the editor's readout.
    expect(screen.getAllByText("75% to under 80% → $1,500 for the month").length).toBe(2);
  });
});
