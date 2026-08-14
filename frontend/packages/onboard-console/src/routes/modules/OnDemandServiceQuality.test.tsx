import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
