import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ApiError } from "@mvta/shared";
import { DecisionMatrixAdmin } from "./DecisionMatrixAdmin.js";

vi.mock("../config.js", () => ({ api: { getDecisionMatrixGovernanceQueue: vi.fn(), getDecisionMatrixAudit: vi.fn(), getDecisionMatrixMatchRules: vi.fn(), getDecisionMatrix: vi.fn(), getDecisionMatrixLegacyCandidates: vi.fn() } }));
import { api } from "../config.js";

/** Every surface connected and empty: the state a migrated database starts in. */
function connected() {
  vi.mocked(api.getDecisionMatrixGovernanceQueue).mockResolvedValue({ procedures: [], diagnostics: { table_ready: true, required_migration: "076" } });
  vi.mocked(api.getDecisionMatrixAudit).mockResolvedValue({ audit_events: [], diagnostics: { table_ready: true, required_migration: "078" } });
  vi.mocked(api.getDecisionMatrixMatchRules).mockResolvedValue({ match_rules: [], diagnostics: { table_ready: true, required_migration: "080" } });
  vi.mocked(api.getDecisionMatrixLegacyCandidates).mockResolvedValue({ candidates: [], diagnostics: { table_ready: true, required_migration: "079" } });
  vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: true, procedure_count: 0 } });
}

/** No Decision Matrix migration has run at all. */
function unmigrated() {
  vi.mocked(api.getDecisionMatrixGovernanceQueue).mockResolvedValue({ procedures: [], diagnostics: { table_ready: false, required_migration: "076" } });
  vi.mocked(api.getDecisionMatrixAudit).mockResolvedValue({ audit_events: [], diagnostics: { table_ready: false, required_migration: "078" } });
  vi.mocked(api.getDecisionMatrixMatchRules).mockResolvedValue({ match_rules: [], diagnostics: { table_ready: false, required_migration: "080" } });
  vi.mocked(api.getDecisionMatrixLegacyCandidates).mockResolvedValue({ candidates: [], diagnostics: { table_ready: false, required_migration: "079" } });
  vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: false, procedure_count: 0 } });
}

beforeEach(() => { vi.clearAllMocks(); connected(); });
afterEach(() => cleanup());

describe("Decision Matrix administration", () => {
  it("says the workspace is not connected and names every missing migration", async () => {
    unmigrated();
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByText(/Decision Matrix is not connected/i)).toBeInTheDocument();
    expect(screen.getByText(/migrations 076, 078, 079, 080/)).toBeInTheDocument();
  });

  it("reports a partly migrated database as partly connected, naming only what is missing", async () => {
    // 051 and 079 have run, so legacy candidates are readable; nothing else is.
    vi.mocked(api.getDecisionMatrixGovernanceQueue).mockResolvedValue({ procedures: [], diagnostics: { table_ready: false, required_migration: "076" } });
    vi.mocked(api.getDecisionMatrixAudit).mockResolvedValue({ audit_events: [], diagnostics: { table_ready: false, required_migration: "078" } });
    vi.mocked(api.getDecisionMatrixMatchRules).mockResolvedValue({ match_rules: [], diagnostics: { table_ready: false, required_migration: "080" } });
    vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: false, procedure_count: 0 } });
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByText(/Decision Matrix is partly connected/i)).toBeInTheDocument();
    expect(screen.getByText(/migrations 076, 078, 080/)).toBeInTheDocument();
    expect(screen.getByText(/No legacy Procedure is waiting to be mapped/i)).toBeInTheDocument();
  });

  it("keeps the surfaces that answered when one of them fails", async () => {
    vi.mocked(api.getDecisionMatrixAudit).mockRejectedValue(new Error("boom"));
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByText(/audit history could not be loaded/i)).toBeInTheDocument();
    // The three that answered are unaffected, and nothing claims a missing migration.
    expect(screen.getByText(/No Procedure revision is awaiting a governance decision/i)).toBeInTheDocument();
    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
  });

  it("withholds the authoring and Match Rule forms when their tables are absent", async () => {
    unmigrated();
    render(<DecisionMatrixAdmin />);
    await screen.findByText(/Decision Matrix is not connected/i);
    expect(screen.queryByRole("button", { name: "Create Draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add rule" })).not.toBeInTheDocument();
  });

  it("offers the forms once the database is migrated", async () => {
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByRole("button", { name: "Create Draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument();
    expect(screen.getByText(/No approved Procedure exists yet/i)).toBeInTheDocument();
  });

  it("names an expired sign-in once, instead of blaming the database in five places", async () => {
    // What dev actually did on 2026-09-06: silent token renewal failed, every
    // request went out without an identity, and every endpoint answered 401.
    const expired = new ApiError(401, "Not authenticated.");
    vi.mocked(api.getDecisionMatrixGovernanceQueue).mockRejectedValue(expired);
    vi.mocked(api.getDecisionMatrixAudit).mockRejectedValue(expired);
    vi.mocked(api.getDecisionMatrixMatchRules).mockRejectedValue(expired);
    vi.mocked(api.getDecisionMatrixLegacyCandidates).mockRejectedValue(expired);
    vi.mocked(api.getDecisionMatrix).mockRejectedValue(expired);
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByText(/Your sign-in has expired/i)).toBeInTheDocument();
    // Said once, not once per panel.
    expect(screen.getAllByText(/Your sign-in has expired/i)).toHaveLength(1);
    // And never described as a database fault.
    expect(screen.queryByText(/fault worth investigating/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not connected/i)).not.toBeInTheDocument();
  });

  it("still calls a genuine server fault a fault", async () => {
    vi.mocked(api.getDecisionMatrixAudit).mockRejectedValue(new ApiError(500, "Decision Matrix audit history is temporarily unavailable."));
    render(<DecisionMatrixAdmin />);
    expect(await screen.findByText(/fault worth investigating/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign-in has expired/i)).not.toBeInTheDocument();
  });

  it("asks for the primary SOP by browsing, not by typing seven identifiers", async () => {
    render(<DecisionMatrixAdmin />);
    await screen.findByRole("button", { name: "Create Draft" });
    expect(screen.getByRole("button", { name: /Browse the approved library/i })).toBeInTheDocument();
    // The machine facts about a file are no longer asked of a person.
    for (const gone of ["SharePoint site ID", "Drive ID", "Item ID", "Expected version", "File name", "MIME type", "SharePoint link"]) {
      expect(screen.queryByLabelText(gone)).not.toBeInTheDocument();
    }
    // The SOP's own code is a human fact and stays.
    expect(screen.getByLabelText("Primary SOP code")).toBeInTheDocument();
  });
});
