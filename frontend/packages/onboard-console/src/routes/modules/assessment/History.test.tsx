import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentPeriod } from "@mvta/shared";
import { api } from "../../../config.js";
import { History } from "./History.js";

vi.mock("../../../config.js", () => ({ api: { getAssessmentAudit: vi.fn() } }));
const period: AssessmentPeriod = { id: "p1", contractor_id: "c1", contractor_name: "Transit Operations", service_month: "202607", status: "finalized", input_revision: 1, computed_revision: 1, proposed_total: 1500, final_total: 1500 };
afterEach(cleanup);

describe("History", () => {
  it("lists the period's trail newest first with the recorded detail", async () => {
    (api.getAssessmentAudit as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [
      { id: 2, entity_type: "period", entity_id: "p1", action: "finalized", actor: "manager@mvta.us", before_json: null, after_json: '{"final_total":1500}', note: null, created_at: "2026-08-10T15:00:00Z" },
      { id: 1, entity_type: "assessment", entity_id: "a1", action: "reviewed", actor: "reviewer@mvta.us", before_json: '{"action":null}', after_json: '{"action":"confirmed"}', note: null, created_at: "2026-08-03T15:00:00Z" },
    ], diagnostics: { limit: 200, offset: 0, returned_count: 2 } });
    render(<History period={period} />);
    const rows = await screen.findAllByRole("row");
    expect(rows[1].textContent).toContain("Finalized");
    expect(rows[2].textContent).toContain("Reviewed");
    expect(screen.getByText('{"final_total":1500}')).toBeTruthy();
    expect(api.getAssessmentAudit).toHaveBeenCalledWith("p1");
  });
  it("says so when nothing has been recorded", async () => {
    (api.getAssessmentAudit as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [], diagnostics: { limit: 200, offset: 0, returned_count: 0 } });
    render(<History period={period} />);
    expect(await screen.findByText(/Nothing has been recorded/)).toBeTruthy();
  });
});
