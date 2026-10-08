import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { DecisionMatrixProcedureAvailability } from "@mvta/shared";
import { DecisionMatrix } from "./DecisionMatrix.js";

vi.mock("../../config.js", () => ({ api: { getDecisionMatrix: vi.fn(), getDecisionMatrixRecommendations: vi.fn(), getDecisionMatrixRendition: vi.fn(), getDecisionMatrixAvailability: vi.fn() } }));
import { api } from "../../config.js";

const procedure = { procedure_id: "occ-collision", revision: 1, condition_key: "vehicle-collision", condition: "Vehicle Collision", severity: "Stop service", severity_meaning: "Begin emergency response.", owner_team: "OCC", owner_contact: "occ@mvta.com", effective_at: "2026-01-01T00:00:00Z", next_review_at: "2027-01-01T00:00:00Z", tags: ["Safety"], criteria: [{ id: "c1", kind: "applies", text: "Any collision with injury." }], immediate_actions: [{ id: "a1", kind: "required", instruction: "Notify command staff" }], document_references: [{ reference_id: "ref1", document_type: "SOP", is_primary: true, document_code: "SOP-1", expected_file_name: "collision.pdf", expected_mime_type: "application/pdf", web_url: "https://sharepoint.example/collision.pdf", health_status: "Valid" as const, checked_at: "2026-08-01T00:00:00Z", health_reason: null, source_available: true, inline_preview_available: false }, { reference_id: "qrg1", document_type: "Visual rendition", is_primary: false, document_code: "QRG-1", expected_file_name: "collision.png", expected_mime_type: "image/png", web_url: "https://sharepoint.example/collision.png", health_status: "Valid" as const, checked_at: "2026-08-01T00:00:00Z", health_reason: null, source_available: false, inline_preview_available: true }] };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [procedure], diagnostics: { table_ready: true, procedure_count: 1 } }); vi.mocked(api.getDecisionMatrixRecommendations).mockResolvedValue({ source_type: "SuggestedAlert", source_qualifier: "collision", recommendations: [] }); vi.mocked(api.getDecisionMatrixRendition).mockResolvedValue(new Blob(["image"], { type: "image/png" })); vi.mocked(api.getDecisionMatrixAvailability).mockResolvedValue({ procedure_id: "occ-collision", availability: { state: "approved" }, diagnostics: { table_ready: true } }); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }); });
afterEach(() => cleanup());
function renderMatrix(entry = "/console/occ") { return render(<MemoryRouter initialEntries={[entry]}><DecisionMatrix /></MemoryRouter>); }

describe("Decision Matrix", () => {
  it("shows approved text guidance before its secondary SharePoint source", async () => { renderMatrix(); expect(await screen.findByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument(); expect(screen.getByText(/Any collision with injury/)).toBeInTheDocument(); expect(screen.getByText("Notify command staff")).toBeInTheDocument(); expect(screen.getByRole("link", { name: /Open primary SOP/i })).toHaveAttribute("href", "https://sharepoint.example/collision.pdf"); });
  it("keeps grid and QRG views available", async () => { renderMatrix(); await screen.findByRole("heading", { name: "Vehicle Collision" }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Grid" })); expect(screen.getByRole("button", { name: "Read" })).toBeInTheDocument(); await user.click(screen.getByRole("button", { name: "QRG" })); expect(screen.getByText(/QRGs are rendered inline/i)).toBeInTheDocument(); });
  it("carries severity on the row and card rails, and announces it to screen readers", async () => { renderMatrix(); const heading = await screen.findByRole("heading", { name: "Vehicle Collision" }); expect(heading.closest("article")).toHaveClass("stop"); expect(screen.getByText("Severity: Stop service")).toBeInTheDocument(); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "Grid" })); expect(screen.getByRole("heading", { name: "Vehicle Collision" }).closest("article")).toHaveClass("card", "stop"); });
  it("leaves the rail neutral for a severity outside the governed three", async () => { vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [{ ...procedure, severity: "Something else" }], diagnostics: { table_ready: true, procedure_count: 1 } }); renderMatrix(); const heading = await screen.findByRole("heading", { name: "Vehicle Collision" }); expect(heading.closest("article")?.className).toBe("row"); });
  it("says the Matrix is not connected when the Procedure tables are missing", async () => { vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: false, procedure_count: 0 } }); renderMatrix(); expect(await screen.findByText(/Decision Matrix is not connected/i)).toBeInTheDocument(); expect(screen.getByText(/migration 076/i)).toBeInTheDocument(); expect(screen.getByText("Not connected")).toBeInTheDocument(); });
  it("separates a connected but unpublished Matrix from a search that matched nothing", async () => { vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: true, procedure_count: 0 } }); renderMatrix(); expect(await screen.findByText(/No Procedure has been approved yet/i)).toBeInTheDocument(); cleanup(); renderMatrix("/console/occ?q=collision"); expect(await screen.findByText(/No approved Procedures match this search/i)).toBeInTheDocument(); });
  it("loads an approved QRG rendition inline and does not expose a Graph URL", async () => { renderMatrix(); await screen.findByRole("heading", { name: "Vehicle Collision" }); const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "View inline" })); expect(await screen.findByRole("img", { name: /collision.png/i })).toHaveAttribute("src", "blob:preview"); expect(vi.mocked(api.getDecisionMatrixRendition)).toHaveBeenCalledWith("occ-collision", 1, "qrg1"); });

  // A controller's bookmark carries ?procedure_id=. The reader lists Approved
  // revisions only, so a withdrawn Procedure used to produce silence next to a
  // list of OTHER guidance - which reads as "nothing is wrong".
  describe("a bookmarked Procedure that is not on screen", () => {
    function availability(value: DecisionMatrixProcedureAvailability) {
      vi.mocked(api.getDecisionMatrixAvailability).mockResolvedValue({ procedure_id: "occ-retired", availability: value, diagnostics: { table_ready: true } });
    }

    it("says a withdrawn Procedure must not be used, and why", async () => {
      availability({ state: "withdrawn", condition: "Bridge strike", decided_at: "2026-10-02T14:30:00.000Z", reason: "The weight limit changed.", replacement: null });
      renderMatrix("/console/occ?procedure_id=occ-retired");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/"Bridge strike" was withdrawn .* and must not be used/i);
      expect(alert).toHaveTextContent(/The weight limit changed/);
      expect(alert).toHaveTextContent(/No replacement has been approved/i);
    });

    it("sends a retired Procedure to its approved replacement", async () => {
      availability({ state: "retired", condition: "Snow route", decided_at: "2026-10-02T14:30:00.000Z", reason: null, replacement: { procedure_id: "occ-collision", revision: 2, condition: "Snow route (2026)" } });
      renderMatrix("/console/occ?procedure_id=occ-retired");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/was retired .* and must not be used/i);
      await userEvent.setup().click(screen.getByRole("button", { name: /Read Snow route \(2026\) instead/i }));
      // Choosing the replacement selects it, which is what the reader does
      // with any Procedure the controller picks.
      expect(screen.getByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument();
    });

    it("stays silent when a search merely filtered an approved Procedure out of view", async () => {
      // The false alarm this endpoint exists to avoid: approved means nothing
      // is wrong, so no warning may appear.
      vi.mocked(api.getDecisionMatrix).mockResolvedValue({ procedures: [], diagnostics: { table_ready: true, procedure_count: 1 } });
      availability({ state: "approved" });
      renderMatrix("/console/occ?q=snow&procedure_id=occ-collision");
      expect(await screen.findByText(/No approved Procedures match this search/i)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/must not be used/i)).not.toBeInTheDocument();
    });

    it("explains a link that names no Procedure, and a Draft that was never approved", async () => {
      availability({ state: "unknown" });
      renderMatrix("/console/occ?procedure_id=occ-retired");
      expect(await screen.findByText(/does not name a Procedure in this Matrix/i)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      cleanup();
      availability({ state: "unpublished", condition: "Flooded underpass" });
      renderMatrix("/console/occ?procedure_id=occ-retired");
      expect(await screen.findByText(/has never been approved/i)).toBeInTheDocument();
    });

    it("does not ask when the bookmarked Procedure is on screen", async () => {
      renderMatrix("/console/occ?procedure_id=occ-collision");
      await screen.findByRole("heading", { name: "Vehicle Collision" });
      expect(vi.mocked(api.getDecisionMatrixAvailability)).not.toHaveBeenCalled();
    });

    it("dismissing the notice leaves the Matrix readable", async () => {
      availability({ state: "withdrawn", condition: "Bridge strike", decided_at: "2026-10-02T14:30:00.000Z", reason: null, replacement: null });
      renderMatrix("/console/occ?procedure_id=occ-retired");
      await screen.findByRole("alert");
      await userEvent.setup().click(screen.getByRole("button", { name: /Dismiss and read the Matrix/i }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Vehicle Collision" })).toBeInTheDocument();
    });
  });
});
