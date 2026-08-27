import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnDemandServiceStandardsAdmin } from "./OnDemandServiceStandardsAdmin.js";

vi.mock("../config.js", () => ({ api: {
  getOnDemandServiceStandards: vi.fn().mockResolvedValue({ default_minutes: 25, zones: [] }),
  getOnDemandServiceStandardAudit: vi.fn().mockResolvedValue({ audit: [] }),
  updateOnDemandServiceStandard: vi.fn(),
  updateOnDemandZoneServiceStandard: vi.fn(),
  removeOnDemandZoneServiceStandard: vi.fn(),
} }));

describe("On-demand service standards administration", () => {
  afterEach(cleanup);

  it("puts the editable all-zones threshold in the Admin submodule", async () => {
    render(<OnDemandServiceStandardsAdmin />);
    expect(await screen.findByText("Service Standards")).toBeInTheDocument();
    expect(screen.getByLabelText("All-zones service standard")).toHaveValue("25");
  });
});
