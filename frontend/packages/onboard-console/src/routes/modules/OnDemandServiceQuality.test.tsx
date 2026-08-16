import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../config.js";
import { OnDemandServiceQuality } from "./OnDemandServiceQuality.js";

vi.mock("../../config.js", () => ({
  api: {
    getOnDemandRisks: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("On-Demand Risk investigation workspace", () => {
  it("keeps the service standard and monitoring contract visible without live records", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("offline"));

    render(
      <MemoryRouter>
        <OnDemandServiceQuality />
      </MemoryRouter>,
    );

    expect(screen.getByText("25 min")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Current wait-risk records are provided by the vendor-neutral on-demand monitoring contract.",
      ),
    ).toBeInTheDocument();
  });

  it("makes Suggested Alert preparation primary and keeps acknowledgement separate", async () => {
    vi.mocked(api.getOnDemandRisks).mockRejectedValueOnce(new Error("preview mode"));

    render(<MemoryRouter><OnDemandServiceQuality /></MemoryRouter>);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Preview Suggested Alert" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Monitor" })).toBeInTheDocument();
  });
});
