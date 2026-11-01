import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RidershipSetupAdmin } from "./RidershipSetupAdmin.js";

const getRidershipBlockGarages = vi.fn();
const saveRidershipBlockGarages = vi.fn();
vi.mock("../config.js", () => ({ api: {
  getRidershipBlockGarages: (...args: unknown[]) => getRidershipBlockGarages(...args),
  saveRidershipBlockGarages: (...args: unknown[]) => saveRidershipBlockGarages(...args),
} }));

const LIST = {
  rows: [
    { block: "024", effective_from: "2026-08-22", garage: "Burnsville", updated_at: "2026-08-20T15:00:00Z", updated_by: "planning@example.test" },
    { block: "105", effective_from: "2026-08-22", garage: "Eagan", updated_at: "2026-08-20T15:00:00Z", updated_by: "planning@example.test" },
  ],
  garages: ["Burnsville", "Eagan"],
  recent_blocks: ["024", "105", "212"],
};

describe("Administration › Ridership setup", () => {
  beforeEach(() => {
    getRidershipBlockGarages.mockReset().mockResolvedValue(LIST);
    saveRidershipBlockGarages.mockReset().mockResolvedValue(LIST);
  });
  afterEach(cleanup);

  it("lists recent blocks with the garage in force, and counts the unassigned", async () => {
    render(<RidershipSetupAdmin />);
    expect(((await screen.findByLabelText("Garage for block 024")) as HTMLInputElement).value).toBe("Burnsville");
    expect((screen.getByLabelText("Garage for block 212") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("1 unassigned")).toBeTruthy();
  });

  it("saves only the blocks that change, from the service change's first day", async () => {
    const user = userEvent.setup();
    render(<RidershipSetupAdmin />);
    const date = await screen.findByLabelText(/In force from/);
    await user.clear(date);
    await user.type(date, "2026-12-05");
    await user.type(screen.getByLabelText("Garage for block 212"), "Eagan");
    await user.clear(screen.getByLabelText("Garage for block 105"));
    await user.click(screen.getByRole("button", { name: "Save the list" }));
    await waitFor(() => expect(saveRidershipBlockGarages).toHaveBeenCalledWith({
      effective_from: "2026-12-05",
      rows: [{ block: "105", garage: null }, { block: "212", garage: "Eagan" }],
    }));
    expect((await screen.findByRole("status")).textContent).toMatch(/2 blocks saved/);
  });

  it("adds a block by number, starting Unassigned", async () => {
    const user = userEvent.setup();
    render(<RidershipSetupAdmin />);
    await user.type(await screen.findByLabelText("Block number"), "7{Enter}");
    expect((screen.getByLabelText("Garage for block 007") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save the list" })).toHaveProperty("disabled", true);
  });
});
