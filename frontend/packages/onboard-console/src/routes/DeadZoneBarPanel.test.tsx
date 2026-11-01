import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissedTripDeadZones } from "@mvta/shared";
import { DeadZoneBarPanel } from "./DeadZoneBarPanel.js";

const getMissedTripDeadZones = vi.fn();
const updateAppSetting = vi.fn();

vi.mock("../config.js", () => ({ api: {
  getMissedTripDeadZones: (...args: unknown[]) => getMissedTripDeadZones(...args),
  updateAppSetting: (...args: unknown[]) => updateAppSetting(...args),
} }));

const DATA: MissedTripDeadZones = {
  bar: { ran_percent: 80, min_cases: 5 },
  configured: true,
  limits: { ran_percent: { min: 50, max: 100 }, min_cases: { min: 3, max: 50 } },
  stops: [
    { stop_id: "1", name: "Savage Park & Ride", cases: 52, ran: 49 },
    { stop_id: "2", name: "Mystic Lake Casino", cases: 24, ran: 17 },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (name: string) => screen.getByRole("cell", { name }).closest("tr")!;

describe("GPS dead-zone bar", () => {
  it("shows each stop against the saved bar", async () => {
    getMissedTripDeadZones.mockResolvedValue(DATA);
    render(<DeadZoneBarPanel />);
    expect(await screen.findByText("1 of 2 stops is flagged.")).toBeInTheDocument();
    expect(within(row("Savage Park & Ride")).getByText("Flagged")).toBeInTheDocument();
    expect(within(row("Mystic Lake Casino")).getByText("70%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save bar" })).toBeDisabled();
  });

  it("previews a lower bar, then saves only the setting that changed", async () => {
    getMissedTripDeadZones.mockResolvedValueOnce(DATA).mockResolvedValueOnce({ ...DATA, bar: { ran_percent: 70, min_cases: 5 } });
    updateAppSetting.mockResolvedValue({});
    const user = userEvent.setup();
    render(<DeadZoneBarPanel />);

    const share = await screen.findByLabelText("Share that ran");
    await user.clear(share);
    await user.type(share, "70");
    expect(screen.getByText("2 of 2 stops would be flagged, up from 1.")).toBeInTheDocument();
    expect(within(row("Mystic Lake Casino")).getByText("Would be flagged")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save bar" }));
    await waitFor(() => expect(updateAppSetting).toHaveBeenCalledTimes(1));
    expect(updateAppSetting).toHaveBeenCalledWith("missed_trip", "dead_zone_ran_percent", "70");
    expect(await screen.findByText(/Saved. Cases are now marked at 70% of at least 5 cases./)).toBeInTheDocument();
  });

  it("refuses a value outside the range and keeps the saved preview", async () => {
    getMissedTripDeadZones.mockResolvedValue(DATA);
    const user = userEvent.setup();
    render(<DeadZoneBarPanel />);
    const share = await screen.findByLabelText("Share that ran");
    await user.clear(share);
    await user.type(share, "40");
    expect(screen.getByText("Enter a whole percent from 50 to 100.")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 stops is flagged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save bar" })).toBeDisabled();
  });

  it("says the bar cannot change before migration 155, and locks the inputs", async () => {
    getMissedTripDeadZones.mockResolvedValue({ ...DATA, configured: false });
    render(<DeadZoneBarPanel />);
    expect(await screen.findByText(/cannot be changed until migration 155 is applied/)).toBeInTheDocument();
    expect(screen.getByLabelText("Share that ran")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save bar" })).toBeDisabled();
  });
});
