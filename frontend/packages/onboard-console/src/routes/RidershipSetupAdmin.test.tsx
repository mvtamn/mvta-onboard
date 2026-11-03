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
    expect(((await screen.findByLabelText("Garage for block 024")) as HTMLSelectElement).value).toBe("Burnsville");
    expect((screen.getByLabelText("Garage for block 212") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Unassigned 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Eagan 1" })).toBeTruthy();
  });

  it("saves only the blocks that change, from the service change's first day", async () => {
    const user = userEvent.setup();
    render(<RidershipSetupAdmin />);
    const date = await screen.findByLabelText(/In force from/);
    await user.clear(date);
    await user.type(date, "2026-12-05");
    await user.selectOptions(screen.getByLabelText("Garage for block 212"), "Eagan");
    await user.selectOptions(screen.getByLabelText("Garage for block 105"), "Unassigned");
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
    expect((screen.getByLabelText("Garage for block 007") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save the list" })).toHaveProperty("disabled", true);
  });

  it("offers only the known garages, so a typo can't start a new print stack", async () => {
    getRidershipBlockGarages.mockResolvedValue({ ...LIST, garages: [] });
    render(<RidershipSetupAdmin />);
    const options = [...((await screen.findByLabelText("Garage for block 212")) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(["Unassigned", "Burnsville", "Eagan"]);
  });

  it("assigns several selected blocks to a garage at once, shift-click selecting a run", async () => {
    const user = userEvent.setup();
    getRidershipBlockGarages.mockResolvedValue({ ...LIST, rows: [], recent_blocks: ["001", "002", "003", "004"] });
    render(<RidershipSetupAdmin />);
    await user.click(await screen.findByLabelText("Select block 001"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByLabelText("Select block 003"));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 blocks")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assign to Eagan" }));
    for (const b of ["001", "002", "003"]) expect((screen.getByLabelText(`Garage for block ${b}`) as HTMLSelectElement).value).toBe("Eagan");
    expect((screen.getByLabelText("Garage for block 004") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save the list" }));
    await waitFor(() => expect(saveRidershipBlockGarages).toHaveBeenCalledWith(expect.objectContaining({
      rows: [{ block: "001", garage: "Eagan" }, { block: "002", garage: "Eagan" }, { block: "003", garage: "Eagan" }],
    })));
  });

  it("selects blocks by a typed range and filters to the unassigned", async () => {
    const user = userEvent.setup();
    render(<RidershipSetupAdmin />);
    await user.type(await screen.findByLabelText("Blocks to select"), "200-299, 24{Enter}");
    expect((screen.getByLabelText("Select block 212") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Select block 024") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Select block 105") as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole("button", { name: "Assign to Burnsville" }));
    await user.click(screen.getByRole("button", { name: "Unassigned 0" }));
    expect(screen.getByText("No block is unassigned.")).toBeTruthy();
  });

  it("says when a typed selection is not block numbers", async () => {
    const user = userEvent.setup();
    render(<RidershipSetupAdmin />);
    await user.type(await screen.findByLabelText("Blocks to select"), "abc{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/1-69, 306, 309/);
  });
});
