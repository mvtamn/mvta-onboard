import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DecisionMatrix } from "./DecisionMatrix.js";

const authState = { roles: ["OCC.Admin"], account: { name: "Test User", username: "test@mvta.com" }, signIn: vi.fn(), signOut: vi.fn() };
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => authState }));
vi.mock("../../config.js", () => ({ api: { getDecisionMatrix: vi.fn(), governDecisionMatrix: vi.fn() } }));

import { api } from "../../config.js";

const procedure = {
  procedure_id: "occ-collision", revision: 1, condition_key: "vehicle-collision", condition: "Vehicle Collision",
  criteria: "Any collision with injury or a blocked lane.", severity: "Stop", severity_meaning: "Begin emergency response.",
  immediate_actions: ["Notify command staff", "Dispatch EMS"], escalation_triggers: ["Any injury"], notifications: ["Command staff"],
  communication_guidance: null, required_documentation: null, tags: ["Safety", "Emergency Response"], service_mode: "FixedRoute",
  affected_workflow: "Emergency Response", urgency: "Immediate", document_type: "SOP" as const, document_code: "SOP-OCC-001-00",
  source_url: "https://example.com/sop", source_revision: "SOP-OCC-001-00", owner: "OCC", approver: "Admin", approval_state: "Approved" as const,
  trust_state: "Approved" as const, effective_at: "2026-01-01T00:00:00Z", next_review_at: "2027-01-01T00:00:00Z", retired_at: null,
  source_status: "available" as const, last_synced_at: "2026-08-12T00:00:00Z", updated_at: "2026-08-12T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [procedure], diagnostics: { table_ready: true, source: "governed" } });
});
afterEach(() => cleanup());

function renderMatrix() { return render(<MemoryRouter><DecisionMatrix /></MemoryRouter>); }

describe("Decision Matrix", () => {
  it("renders governed content and the full SOP action", async () => {
    renderMatrix();
    expect(await screen.findByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument();
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Open SOP/i })).toHaveAttribute("href", "https://example.com/sop");
  });

  it("lets staff filter and clear a governed result", async () => {
    renderMatrix();
    await screen.findByRole("heading", { name: "Vehicle Collision" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Stale" }));
    expect(screen.getByText(/No Procedures match/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(screen.getByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument();
  });

  it("shows unavailable source failures as a visible error state", async () => {
    vi.mocked(api.getDecisionMatrix).mockRejectedValueOnce(new Error("offline"));
    renderMatrix();
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
  });

  it("does not expose the retired SharePoint structured-content import", async () => {
    renderMatrix();
    await screen.findByRole("heading", { name: "Vehicle Collision" });
    expect(screen.queryByRole("button", { name: /sync sharepoint source/i })).not.toBeInTheDocument();
  });
});
