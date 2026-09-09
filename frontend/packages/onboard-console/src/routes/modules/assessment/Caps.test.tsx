import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentCap, AssessmentPeriod } from "@mvta/shared";
import { api } from "../../../config.js";
import { Caps } from "./Caps.js";

vi.mock("../../../config.js", () => ({ api: { getAssessmentCaps: vi.fn(), transitionAssessmentCap: vi.fn() } }));
vi.mock("../../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.ComplianceManager"] }) }));
vi.mock("../../../components/AppDialog.js", () => ({ useAppDialog: () => ({ prompt: vi.fn().mockResolvedValue("Verified two clean months") }) }));

const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "issued", input_revision: 1, computed_revision: 1, proposed_total: 1500, final_total: 1500 };
const cap = (over: Partial<AssessmentCap>): AssessmentCap => ({ id: "cap1", standard_name: "Fixed-route OTP", status: "required", trigger_reason: "tier_rule", due_at: "2026-08-17T00:00:00Z", overdue: false, submitted_at: null, closed_at: null, root_cause: null, corrective_actions: null, responsible_parties: null, timeline_note: null, monitoring_plan: null, closure_criteria: null, closure_note: null, ...over });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Caps", () => {
  it("submits the six elements from one form and flags an overdue plan", async () => {
    (api.getAssessmentCaps as ReturnType<typeof vi.fn>).mockResolvedValue({ caps: [cap({ overdue: true })] });
    (api.transitionAssessmentCap as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cap1", status: "submitted" });
    render(<Caps period={period} rows={[]} />);
    await screen.findByText(/Overdue/);
    await userEvent.click(screen.getByRole("button", { name: "Record submission" }));
    for (const label of ["Root cause", "Corrective actions", "Responsible parties", "Timeline", "Monitoring plan", "Closure criteria"]) {
      await userEvent.type(screen.getByLabelText(label), `${label} text`);
    }
    await userEvent.click(screen.getByRole("button", { name: "Submit plan" }));
    await waitFor(() => expect(api.transitionAssessmentCap).toHaveBeenCalledWith("cap1", "submitted", expect.objectContaining({ root_cause: "Root cause text", closure_criteria: "Closure criteria text" })));
  });

  it("offers the manager the next steps and closes with a note", async () => {
    (api.getAssessmentCaps as ReturnType<typeof vi.fn>).mockResolvedValue({ caps: [cap({ status: "in_progress" })] });
    (api.transitionAssessmentCap as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cap1", status: "closed" });
    render(<Caps period={period} rows={[]} />);
    await screen.findByText("Fixed-route OTP");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(api.transitionAssessmentCap).toHaveBeenCalledWith("cap1", "closed", { closure_note: "Verified two clean months" }));
  });

  it("shows what a closed plan recorded and offers nothing further", async () => {
    (api.getAssessmentCaps as ReturnType<typeof vi.fn>).mockResolvedValue({ caps: [cap({ status: "closed", closure_note: "Two clean months", closed_at: "2026-10-01T00:00:00Z", root_cause: "Staffing" })] });
    render(<Caps period={period} rows={[]} />);
    await screen.findByText(/Two clean months/);
    expect(screen.queryAllByRole("button").filter(b => /Approve|Close|Fail|Start|Record submission|Return/.test(b.textContent ?? ""))).toHaveLength(0);
  });
});
