import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceContractorsAdmin } from "./PerformanceContractorsAdmin.js";
import { PerformanceAgreementsAdmin } from "./PerformanceAgreementsAdmin.js";

let roles: string[] = ["OCC.Admin"];
vi.mock("../auth/AuthContext.js", () => ({ useAuth: () => ({ roles }) }));

const putContractor = vi.fn().mockResolvedValue({ id: "c1" });
const putPerformanceAgreement = vi.fn().mockResolvedValue({ id: "a1" });
let contractors: { contractors: unknown[]; diagnostics: { table_ready: boolean } };
let agreements: { agreements: unknown[]; assignments: unknown[]; diagnostics: { table_ready: boolean } };

vi.mock("../config.js", () => ({ api: {
  getContractors: () => Promise.resolve(contractors),
  putContractor: (...args: unknown[]) => putContractor(...args),
  getPerformanceAgreements: () => Promise.resolve(agreements),
  putPerformanceAgreement: (...args: unknown[]) => putPerformanceAgreement(...args),
} }));

const CONTRACTOR = { id: "c1", name: "Transit Operator", contract_start_date: "20250101", contract_end_date: null, is_active: true };
const AGREEMENT = {
  id: "a1", contractor_id: "c1", contractor_name: "Transit Operator", starts_on: "20250101", ends_on: "20291231",
  validation_business_days: 5, retention_years: 7, is_active: true, scored_standard_count: 9,
  contract_number: "RFP 2025-07", exhibit_reference: "Attachment G v2",
};

beforeEach(() => {
  roles = ["OCC.Admin"];
  contractors = { contractors: [CONTRACTOR], diagnostics: { table_ready: true } };
  agreements = { agreements: [AGREEMENT], assignments: [], diagnostics: { table_ready: true } };
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Contractors, as its own section", () => {
  it("edits a contractor without opening an Agreement or a scorecard", async () => {
    // A contractor outlives any one term, so it is not edited inside one.
    render(<MemoryRouter><PerformanceContractorsAdmin /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Transit Operator"));
    const name = screen.getByText("Name").closest("label")!;
    fireEvent.change(within(name).getByRole("textbox"), { target: { value: "Transit Operator LLC" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contractor" }));
    await waitFor(() => expect(putContractor).toHaveBeenCalledWith("c1", expect.objectContaining({
      name: "Transit Operator LLC", contract_start_date: "20250101", is_active: true,
    })));
  });

  it("says plainly what an empty contractor list blocks", async () => {
    contractors = { contractors: [], diagnostics: { table_ready: true } };
    render(<MemoryRouter><PerformanceContractorsAdmin /></MemoryRouter>);
    expect(await screen.findByText(/no Agreement can be created and no assessment period can be opened/)).toBeInTheDocument();
  });

  it("lets a non-administrator read but not change", async () => {
    roles = ["OCC.Compliance"];
    render(<MemoryRouter><PerformanceContractorsAdmin /></MemoryRouter>);
    expect(await screen.findByText(/requires Administrator access/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New contractor" })).not.toBeInTheDocument();
  });
});

describe("Agreements, as its own section", () => {
  it("shows every term a contractor has had, not only the current one", async () => {
    // The strip this replaces only ever showed the active Agreement.
    agreements = {
      ...agreements,
      agreements: [AGREEMENT, { ...AGREEMENT, id: "a0", starts_on: "20200101", ends_on: "20241231", is_active: false, exhibit_reference: "Attachment G v1" }],
    };
    render(<MemoryRouter><PerformanceAgreementsAdmin /></MemoryRouter>);
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByText(/Attachment G v1/)).toBeInTheDocument();
  });

  it("records the contract number and the exhibit the standards come from", async () => {
    render(<MemoryRouter><PerformanceAgreementsAdmin /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Transit Operator"));
    expect(screen.getByLabelText("Contract number")).toHaveValue("RFP 2025-07");
    fireEvent.change(screen.getByLabelText(/Standards exhibit/), { target: { value: "Exhibit 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Agreement" }));
    await waitFor(() => expect(putPerformanceAgreement).toHaveBeenCalledWith("a1", expect.objectContaining({
      contract_number: "RFP 2025-07", exhibit_reference: "Exhibit 4",
    })));
  });

  it("refuses to offer a new Agreement with no contractor to bind", async () => {
    contractors = { contractors: [], diagnostics: { table_ready: true } };
    render(<MemoryRouter><PerformanceAgreementsAdmin /></MemoryRouter>);
    expect(await screen.findByText(/an Agreement binds one. Add a contractor first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Agreement" })).toBeDisabled();
  });

  it("says what having no Agreement at all blocks", async () => {
    agreements = { agreements: [], assignments: [], diagnostics: { table_ready: true } };
    render(<MemoryRouter><PerformanceAgreementsAdmin /></MemoryRouter>);
    expect(await screen.findByText(/no assessment period can be opened and the compliance candidate poll fails on every run/)).toBeInTheDocument();
  });
});
