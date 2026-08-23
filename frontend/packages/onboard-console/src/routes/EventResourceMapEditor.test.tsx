import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppDialogProvider } from "../components/AppDialog.js";

const api = vi.hoisted(() => ({
  addEventGeofenceRule: vi.fn(),
  getEventGeofencePurposes: vi.fn(),
  getEventGeofences: vi.fn(),
  getEventLocations: vi.fn(),
  getEventServicePlans: vi.fn(),
  updateEventGeofenceRule: vi.fn(),
}));

vi.mock("azure-maps-control", () => ({}));
vi.mock("azure-maps-drawing-tools", () => ({ drawing: { DrawingMode: { idle: "idle" } } }));
vi.mock("../config.js", () => ({ api }));
vi.mock("../auth/AuthContext.js", () => ({ useAuth: () => ({ account: null, signIn: vi.fn() }) }));

import { EventResourceMapEditor } from "./EventResourceMapEditor.js";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("EventResourceMapEditor", () => {
  it("starts a new rule after changing Monitoring Areas while editing", async () => {
    api.getEventGeofences.mockResolvedValue({ geofences: [
      { id: "area-a", name: "Area A", purpose: "other", is_active: true, updated_at: "2026-08-22T00:00:00Z", updated_by: null, polygon: "{}", rules: [{ id: "rule-a", geofence_id: "area-a", name: "Original", transition: "exit", heading_min: 0, heading_max: 360, destination_label: "Proceed", destination_location_id: null, message_type: "custom", send_mode: "manual", sort_order: 0 }] },
      { id: "area-b", name: "Area B", purpose: "other", is_active: true, updated_at: "2026-08-22T00:00:00Z", updated_by: null, polygon: "{}", rules: [] },
    ] });
    api.getEventLocations.mockResolvedValue({ locations: [] });
    api.getEventServicePlans.mockResolvedValue({ plans: [] });
    api.getEventGeofencePurposes.mockResolvedValue({ purposes: [{ code: "other", label: "Other", sort_order: 0, is_system: true }] });
    api.addEventGeofenceRule.mockResolvedValue({});

    render(<MemoryRouter><AppDialogProvider><EventResourceMapEditor /></AppDialogProvider></MemoryRouter>);
    const user = userEvent.setup();
    const area = await screen.findByLabelText("Monitoring Area");
    await user.selectOptions(area, "area-a");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.selectOptions(area, "area-b");
    const instruction = screen.getByLabelText("Message instruction");
    await user.type(instruction, "New instruction");
    expect(instruction).toHaveValue("New instruction");
    const save = screen.getByRole("button", { name: "Save direction rule" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(api.addEventGeofenceRule).toHaveBeenCalledWith("area-b", expect.anything()));
    expect(api.updateEventGeofenceRule).not.toHaveBeenCalled();
  });
});
