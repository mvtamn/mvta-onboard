import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { DecisionMatrix } from "./DecisionMatrix.js";

vi.mock("../../config.js", () => ({ api: { getDecisionMatrix: vi.fn(), getDecisionMatrixRecommendations: vi.fn(), getDecisionMatrixRendition: vi.fn() } }));
vi.mock("../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.Viewer"] }) }));
import { api } from "../../config.js";

const procedure = { procedure_id: "occ-collision", revision: 1, condition_key: "vehicle-collision", condition: "Vehicle Collision", severity: "Stop service", severity_meaning: "Begin emergency response.", owner_team: "OCC", owner_contact: "occ@mvta.com", effective_at: "2026-01-01T00:00:00Z", next_review_at: "2027-01-01T00:00:00Z", tags: ["Safety"], criteria: [{ id: "c1", kind: "applies", text: "Any collision with injury." }], immediate_actions: [{ id: "a1", kind: "required", instruction: "Notify command staff" }], document_references: [{ reference_id: "ref1", document_type: "SOP", is_primary: true, document_code: "SOP-1", expected_file_name: "collision.pdf", expected_mime_type: "application/pdf", web_url: "https://sharepoint.example/collision.pdf", health_status: "Valid" as const, checked_at: "2026-08-01T00:00:00Z", health_reason: null, source_available: true, inline_preview_available: false }, { reference_id: "qrg1", document_type: "Visual rendition", is_primary: false, document_code: "QRG-1", expected_file_name: "collision.png", expected_mime_type: "image/png", web_url: "https://sharepoint.example/collision.png", health_status: "Valid" as const, checked_at: "2026-08-01T00:00:00Z", health_reason: null, source_available: false, inline_preview_available: true }] };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [procedure] }); vi.mocked(api.getDecisionMatrixRecommendations).mockResolvedValue({ source_type: "SuggestedAlert", source_qualifier: "collision", recommendations: [] }); vi.mocked(api.getDecisionMatrixRendition).mockResolvedValue(new Blob(["image"], { type: "image/png" })); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }); });
afterEach(() => cleanup());
function renderMatrix(entry = "/console/occ") { return render(<MemoryRouter initialEntries={[entry]}><DecisionMatrix /></MemoryRouter>); }

describe("Decision Matrix", () => {
  it("shows approved text guidance before its secondary SharePoint source", async () => { renderMatrix(); expect(await screen.findByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument(); expect(screen.getByText(/Any collision with injury/)).toBeInTheDocument(); expect(screen.getByText("Notify command staff")).toBeInTheDocument(); expect(screen.getByRole("link", { name: /Open primary SOP/i })).toHaveAttribute("href", "https://sharepoint.example/collision.pdf"); });
  it("keeps grid and QRG views available", async () => { renderMatrix(); await screen.findByRole("heading", { name: "Vehicle Collision" }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Grid" })); expect(screen.getByRole("button", { name: "Read" })).toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "QRG" })); expect(screen.getByText(/QRGs are rendered inline/i)).toBeInTheDocument(); });
  it("loads an approved QRG rendition inline and does not expose a Graph URL", async () => { renderMatrix(); await screen.findByRole("heading", { name: "Vehicle Collision" }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "View inline" })); expect(await screen.findByRole("img", { name: /collision.png/i })).toHaveAttribute("src", "blob:preview"); expect(vi.mocked(api.getDecisionMatrixRendition)).toHaveBeenCalledWith("occ-collision", 1, "qrg1"); });
});
