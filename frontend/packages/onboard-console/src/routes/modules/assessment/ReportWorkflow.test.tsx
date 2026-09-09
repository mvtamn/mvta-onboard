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
    getAssessmentReportDownload: vi.fn(),
    createAssessmentReport: vi.fn(),
    issueAssessmentReport: vi.fn(),
    shareValidationDraft: vi.fn(),
  },
}));
vi.mock("../../../components/AppDialog.js", () => ({ useAppDialog: () => ({ prompt: vi.fn() }) }));

const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "finalized", input_revision: 1, computed_revision: 1, proposed_total: 1500, final_total: 1500 };
const report = (over: Partial<AssessmentReport>): AssessmentReport => ({ id: "r", period_id: "p1", issuance_type: "final", version: 1, content_sha256: "a".repeat(64), proof_sha256: null, supersedes_id: null, supersede_reason: null, issued_at: null, voided_at: null, voided_by: null, dispute_deadline_at: null, ...over });
const reports = (...rows: AssessmentReport[]) => (api.getAssessmentReports as ReturnType<typeof vi.fn>).mockResolvedValue({ reports: rows });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const act = async (fn: () => Promise<unknown>) => { await fn(); };

afterEach(() => { cleanup(); vi.clearAllMocks(); });
// jsdom cannot navigate; the anchor click is the browser's job.
HTMLAnchorElement.prototype.click = vi.fn();

describe("ReportWorkflow", () => {
  it("opens the archived bytes in a same-origin sandbox and only then allows issuing", async () => {
    reports(report({ id: "proof-2", version: 2 }));
    (api.getAssessmentReportHtml as ReturnType<typeof vi.fn>).mockResolvedValue("<!doctype html><h1>Issuance Proof</h1>");
    render(<ReportWorkflow period={period} busy={false} act={act} />);
    await screen.findByText("Issuance Proof");
    expect(button("Issue Final Assessment").disabled).toBe(true);
    await userEvent.click(button("Preview"));
    const frame = await screen.findByTitle("Assessment artifact preview");
    expect(api.getAssessmentReportHtml).toHaveBeenCalledWith("proof-2");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(frame.getAttribute("srcdoc")).toContain("Issuance Proof");
    expect(screen.getByText(/SHA-256/)).toBeTruthy();
    expect(button("Print convenience copy")).toBeTruthy();
    expect(button("Issue Final Assessment").disabled).toBe(false);
  });

  it("downloads the server's bytes untouched", async () => {
    reports(report({ id: "final", issued_at: "2026-08-10T15:05:00Z", proof_sha256: "b".repeat(64) }));
    const blob = new Blob(["<!doctype html>"], { type: "text/html" });
    (api.getAssessmentReportDownload as ReturnType<typeof vi.fn>).mockResolvedValue(blob);
    const createObjectURL = vi.fn(() => "blob:x"); const revoke = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL: revoke });
    render(<ReportWorkflow period={{ ...period, status: "issued" }} busy={false} act={act} />);
    await screen.findByText("Final Assessment");
    await userEvent.click(button("Download official HTML"));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(blob));
    expect(api.getAssessmentReportHtml).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("labels a voided proof, offers no download for it, and offers a new proof while one is live", async () => {
    reports(report({ id: "proof-2", version: 2 }), report({ id: "proof-1", version: 1, voided_at: "2026-08-10T15:00:00Z", voided_by: "manager@mvta.us" }));
    render(<ReportWorkflow period={period} busy={false} act={act} />);
    await screen.findByText("Issuance Proof (voided)");
    expect(button("Prepare a new Issuance Proof")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Download proof" })).toHaveLength(1);
  });

  it("with only a voided proof there is nothing to issue", async () => {
    reports(report({ id: "proof-1", version: 1, voided_at: "2026-08-10T15:00:00Z" }));
    render(<ReportWorkflow period={period} busy={false} act={act} />);
    await screen.findByText("Issuance Proof (voided)");
    expect(button("Issue Final Assessment").disabled).toBe(true);
    expect(button("Prepare Issuance Proof").disabled).toBe(false);
  });

  it("shows both hashes on an issued Final and offers neither Prepare nor Issue", async () => {
    reports(report({ id: "final", issued_at: "2026-08-10T15:05:00Z", proof_sha256: "b".repeat(64) }));
    render(<ReportWorkflow period={{ ...period, status: "issued" }} busy={false} act={act} />);
    await screen.findByText("Final Assessment");
    expect(screen.getByText(/^proof/)).toBeTruthy();
    expect(button("Issue Final Assessment").disabled).toBe(true);
    expect(button("Prepare Issuance Proof").disabled).toBe(true);
  });
});
