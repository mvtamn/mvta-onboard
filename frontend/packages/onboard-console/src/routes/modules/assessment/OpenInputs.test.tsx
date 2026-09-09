import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentPeriod } from "@mvta/shared";
import { api } from "../../../config.js";
import { OpenInputs } from "./OpenInputs.js";

vi.mock("../../../config.js", () => ({ api: { getOpenManualInputs: vi.fn() } }));
vi.mock("../../../auth/AuthContext.js", () => ({ useAuth: () => ({ roles: [], account: { username: "Rob@mvta.us" } }) }));
const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "open", input_revision: 0, computed_revision: null, proposed_total: 0, final_total: null };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("OpenInputs", () => {
  it("names the signed-in owner's missing figures first, then everyone else's", async () => {
    (api.getOpenManualInputs as ReturnType<typeof vi.fn>).mockResolvedValue({ service_month: "202607", open: [
      { standard_id: "s1", code: "AVG_MILES_ROAD_CALLS", name: "Avg miles between road calls", assigned_to: "Rob", responsible_team: "Maintenance", contractor_id: "c1", contractor_name: "Transit Operations", principal_upn: "rob@mvta.us" },
      { standard_id: "s2", code: "OPERATOR_CONDUCT", name: "Operator conduct", assigned_to: "Corrina", responsible_team: "Customer Service", contractor_id: "c1", contractor_name: "Transit Operations", principal_upn: "corrina@mvta.us" },
      { standard_id: "s3", code: "OTHER", name: "Other contractor's item", assigned_to: "Rob", responsible_team: null, contractor_id: "c2", contractor_name: "Someone else", principal_upn: "rob@mvta.us" },
    ] });
    render(<OpenInputs period={period} />);
    expect((await screen.findByText(/Yours to enter/)).parentElement?.textContent).toContain("Avg miles between road calls");
    expect(screen.getByText(/Still open/).parentElement?.textContent).toContain("Operator conduct (Corrina)");
    expect(screen.queryByText(/Other contractor/)).toBeNull();
  });
  it("renders nothing when the month is complete", async () => {
    (api.getOpenManualInputs as ReturnType<typeof vi.fn>).mockResolvedValue({ service_month: "202607", open: [] });
    const { container } = render(<OpenInputs period={period} />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
