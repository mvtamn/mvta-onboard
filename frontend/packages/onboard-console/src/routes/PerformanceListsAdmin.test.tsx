import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceListsAdmin } from "./PerformanceListsAdmin.js";

let roles: string[] = ["OCC.Admin"];
vi.mock("../auth/AuthContext.js", () => ({ useAuth: () => ({ roles }) }));

const putReferenceValue = vi.fn().mockResolvedValue({ id: "r1" });
const deleteReferenceValue = vi.fn().mockResolvedValue({ id: "r1" });
let values: { values: unknown[]; diagnostics: { table_ready: boolean } };

vi.mock("../config.js", () => ({ api: {
  getReferenceValues: () => Promise.resolve(values),
  putReferenceValue: (...args: unknown[]) => putReferenceValue(...args),
  deleteReferenceValue: (...args: unknown[]) => deleteReferenceValue(...args),
} }));

const REFERENCE_VALUES = [
  { id: "r-unit-pct", domain: "unit", value: "percent", label: "Percent (%)", description: null, sort_order: 1, severity_order: null, is_active: true, is_system: false },
  { id: "r-sys-nexus", domain: "source_system", value: "Nexus", label: "Nexus (Trackit)", description: null, sort_order: 1, severity_order: null, is_active: true, is_system: false },
  { id: "r-tier-1", domain: "tier_label", value: "tier1", label: "Tier 1 penalty", description: null, sort_order: 3, severity_order: 2, is_active: true, is_system: true },
  { id: "r-basis-flat", domain: "penalty_basis", value: "flat", label: "Flat amount for the month", description: "Charged once.", sort_order: 2, severity_order: null, is_active: true, is_system: true },
];

describe("Performance assessment lists", () => {
  beforeEach(() => {
    roles = ["OCC.Admin"];
    values = { values: REFERENCE_VALUES, diagnostics: { table_ready: true } };
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("edits a list the agency owns", async () => {
    render(<PerformanceListsAdmin />);
    fireEvent.blur(await screen.findByLabelText("Label for percent"), { target: { value: "Percentage" } });
    expect(putReferenceValue).toHaveBeenCalledWith("r-unit-pct", expect.objectContaining({
      domain: "unit", value: "percent", label: "Percentage",
    }));
  });

  it("will not let a charge basis be invented or deleted", async () => {
    // computePenalty switches exhaustively over the bases behind a `never`
    // check, so one added here would have no arithmetic at all.
    render(<PerformanceListsAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /^Charge bases/ }));
    expect(screen.getByText(/branches on these values/)).toBeInTheDocument();
    expect(screen.queryByText(/^Add to/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("lets a system value be relabelled, which is the point of the split", async () => {
    render(<PerformanceListsAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /^Tier labels/ }));
    fireEvent.blur(screen.getByLabelText("Label for tier1"), { target: { value: "Level 1 Liquidated Damages" } });
    expect(putReferenceValue).toHaveBeenCalledWith("r-tier-1", expect.objectContaining({
      value: "tier1", label: "Level 1 Liquidated Damages",
    }));
  });

  it("ranks tiers as data, so a fifth tier needs no code change", async () => {
    render(<PerformanceListsAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /^Tier labels/ }));
    fireEvent.blur(screen.getByLabelText("Rank for tier1"), { target: { value: "5" } });
    expect(putReferenceValue).toHaveBeenCalledWith("r-tier-1", expect.objectContaining({ severity_order: 5 }));
  });

  it("adds a value to a list the agency owns", async () => {
    render(<PerformanceListsAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: /^Source systems/ }));
    fireEvent.change(screen.getByPlaceholderText("stored value"), { target: { value: "Trapeze" } });
    fireEvent.change(screen.getByPlaceholderText("what the console shows"), { target: { value: "Trapeze OPS" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add to source systems$/ }));
    expect(putReferenceValue).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      domain: "source_system", value: "Trapeze", label: "Trapeze OPS",
    }));
  });

  it("lets a non-administrator read the lists but change nothing", async () => {
    roles = ["OCC.Compliance"];
    render(<PerformanceListsAdmin />);
    expect(await screen.findByText(/requires Administrator access/)).toBeInTheDocument();
    expect(screen.getByLabelText("Label for percent")).toBeDisabled();
  });

  it("says there is nothing to edit before migration 105", async () => {
    values = { values: [], diagnostics: { table_ready: false } };
    render(<PerformanceListsAdmin />);
    expect(await screen.findByText(/Migration 105 has not been applied/)).toBeInTheDocument();
  });
});
