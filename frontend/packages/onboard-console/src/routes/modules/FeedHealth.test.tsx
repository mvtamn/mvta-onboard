import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedHealth } from "./FeedHealth.js";

const { getFeedChecks } = vi.hoisted(() => ({ getFeedChecks: vi.fn() }));
vi.mock("../../config.js", () => ({ api: { getFeedChecks } }));

afterEach(() => cleanup());

describe("FeedHealth", () => {
  it("shows live, empty, and failed feed results after an explicit check", async () => {
    getFeedChecks.mockResolvedValueOnce({
      checked_at: "2026-08-14T22:00:00Z",
      checks: [
        { name: "TripUpdates", configured: true, status: 200, records: 134 },
        { name: "Pullout", configured: true, status: 200, records: 0 },
        { name: "Spare", configured: true, status: 401 },
      ],
    });
    render(<FeedHealth />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Check feeds" }));

    expect(await screen.findByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(getFeedChecks).toHaveBeenCalledOnce();
  });
});
