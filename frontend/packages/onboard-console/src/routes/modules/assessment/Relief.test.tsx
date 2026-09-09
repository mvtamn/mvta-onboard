import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentPeriod, ExcusableDelayClaim, SystemOutageWindow } from "@mvta/shared";
import { api } from "../../../config.js";
import { Relief } from "./Relief.js";

vi.mock("../../../config.js", () => ({ api: { getExcusableDelayClaims: vi.fn(), createExcusableDelayClaim: vi.fn(), decideExcusableDelayClaim: vi.fn(), getSystemOutages: vi.fn(), createSystemOutage: vi.fn(), endSystemOutage: vi.fn() } }));
vi.mock("../../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: ["OCC.ComplianceManager"] }) }));
vi.mock("../../../components/AppDialog.js", () => ({ useAppDialog: () => ({ prompt: vi.fn().mockResolvedValue("Documentation reviewed") }) }));

const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "in_review", input_revision: 1, computed_revision: 1, proposed_total: 1500, final_total: null };
const claim = (over: Partial<ExcusableDelayClaim> = {}): ExcusableDelayClaim => ({ id: "cl1", contractor_id: "c1", service_month: "202607", event_description: "Ice storm", event_started_at: "2026-07-12T06:00:00Z", notice_received_at: "2026-07-14T06:00:00Z", documentation_note: null, status: "submitted", late_notice: true, decided_by: null, decided_at: null, decision_note: null, created_by: "r", created_at: "2026-07-14T07:00:00Z", ...over });
const outage = (over: Partial<SystemOutageWindow> = {}): SystemOutageWindow => ({ id: "ow1", system: "Avail_CAD_AVL", started_at: "2026-07-20T10:00:00Z", ended_at: null, scope_note: "AVL feed down", logged_by: "r", logged_at: "2026-07-20T10:05:00Z", ...over });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Relief", () => {
  it("flags a late-notice claim and lets the Issuing Authority decide it", async () => {
    (api.getExcusableDelayClaims as ReturnType<typeof vi.fn>).mockResolvedValue({ claims: [claim()] });
    (api.getSystemOutages as ReturnType<typeof vi.fn>).mockResolvedValue({ outages: [] });
    (api.decideExcusableDelayClaim as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cl1", status: "denied" });
    render(<Relief period={period} onChanged={() => undefined} />);
    await screen.findByText("Ice storm");
    expect(screen.getByText(/Late notice/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(api.decideExcusableDelayClaim).toHaveBeenCalledWith("cl1", "denied", "Documentation reviewed"));
  });

  it("files a claim for the selected month", async () => {
    (api.getExcusableDelayClaims as ReturnType<typeof vi.fn>).mockResolvedValue({ claims: [] });
    (api.getSystemOutages as ReturnType<typeof vi.fn>).mockResolvedValue({ outages: [] });
    (api.createExcusableDelayClaim as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "new" });
    render(<Relief period={period} onChanged={() => undefined} />);
    await screen.findByText(/No excusable-delay claims/);
    await userEvent.type(screen.getByLabelText("Event"), "Flooding on Route 420");
    await userEvent.type(screen.getByLabelText("Event started"), "2026-07-12T06:00");
    await userEvent.type(screen.getByLabelText("Notice received"), "2026-07-12T18:00");
    await userEvent.click(screen.getByRole("button", { name: "File claim" }));
    await waitFor(() => expect(api.createExcusableDelayClaim).toHaveBeenCalledWith(expect.objectContaining({ contractor_id: "c1", service_month: "202607", event_description: "Flooding on Route 420" })));
  });

  it("shows an open outage window and can end it", async () => {
    (api.getExcusableDelayClaims as ReturnType<typeof vi.fn>).mockResolvedValue({ claims: [] });
    (api.getSystemOutages as ReturnType<typeof vi.fn>).mockResolvedValue({ outages: [outage()] });
    (api.endSystemOutage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ow1" });
    render(<Relief period={period} onChanged={() => undefined} />);
    await screen.findByText(/AVL feed down/);
    expect(screen.getByText(/still open/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "End window" }));
    await waitFor(() => expect(api.endSystemOutage).toHaveBeenCalledWith("ow1", expect.any(String)));
  });
});
