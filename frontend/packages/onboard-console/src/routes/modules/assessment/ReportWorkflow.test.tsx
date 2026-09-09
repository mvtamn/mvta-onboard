import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentPeriod, AssessmentReport } from "@mvta/shared";
import { api } from "../../../config.js";
import { ReportWorkflow } from "./ReportWorkflow.js";

vi.mock("../../../config.js", () => ({
  api: {
    getAssessmentReports: vi.fn(),
    getAssessmentReportHtml: vi.fn(),
    createAssessmentReport: vi.fn(),
    issueAssessmentReport: vi.fn(),
    shareValidationDraft: vi.fn(),
  },
}));
vi.mock("../../../components/AppDialog.js", () => ({ useAppDialog: () => ({ prompt: vi.fn() }) }));

const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "finalized", input_revision: 1, computed_revision: 1, proposed_total: 1500, final_total: 1500 };
const report = (over: Partial<AssessmentReport>): AssessmentReport => ({ id: "r", period_id: "p1", issuance_type: "final", version: 1, content_sha256: "a".repeat(64), proof_sha256: null, supersedes_id: null, supersede_reason: null, issued_at: null, voided_at: null, voided_by: null, dispute_deadline_at: null, ...over });

afterEach(cleanup);

describe("ReportWorkflow", () => {
  it("opens the archived bytes of an artifact in a sandboxed preview", async () => {
    (api.getAssessmentReports as ReturnType<typeof vi.fn>).mockResolvedValue({ reports: [report({ id: "proof-2", version: 2 })] });
    (api.getAssessmentReportHtml as ReturnType<typeof vi.fn>).mockResolvedValue("<!doctype html><h1>Issuance Proof</h1>");
    render(<ReportWorkflow period={period} busy={false} act={async fn => { await fn(); }} />);
    await screen.findByText("Issuance Proof");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    const frame = await screen.findByTitle("Assessment artifact preview");
    expect(api.getAssessmentReportHtml).toHaveBeenCalledWith("proof-2");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Issuance Proof");
    expect(screen.getByText(/SHA-256/)).toBeTruthy();
  });

  it("labels a voided proof and offers a new proof while one is live", async () => {
    (api.getAssessmentReports as ReturnType<typeof vi.fn>).mockResolvedValue({ reports: [
      report({ id: "proof-2", version: 2 }),
      report({ id: "proof-1", version: 1, voided_at: "2026-08-10T15:00:00Z", voided_by: "manager@mvta.us" }),
    ] });
    render(<ReportWorkflow period={period} busy={false} act={async fn => { await fn(); }} />);
    await screen.findByText("Issuance Proof (voided)");
    expect(screen.getByRole("button", { name: "Prepare a new Issuance Proof" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Issue Final Assessment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows both hashes on an issued Final and offers no proof to issue", async () => {
    (api.getAssessmentReports as ReturnType<typeof vi.fn>).mockResolvedValue({ reports: [report({ id: "final", issued_at: "2026-08-10T15:05:00Z", proof_sha256: "b".repeat(64) })] });
    render(<ReportWorkflow period={{ ...period, status: "issued" }} busy={false} act={async fn => { await fn(); }} />);
    await screen.findByText("Final Assessment");
    expect(screen.getByText(/^proof/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Issue Final Assessment" }) as HTMLButtonElement).disabled).toBe(true));
  });
});
