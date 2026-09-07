import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  getMonitoringAreaTests: vi.fn(),
  startMonitoringAreaTest: vi.fn(),
  stopMonitoringAreaTest: vi.fn(),
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
    api.getEventLocations.mockResolvedValue({ locations: [{ id: "location-a", name: "Eagan Bus Garage", category: "other", latitude: 44.8, longitude: -93.2, notes: null, is_active: true }] });
    api.getEventServicePlans.mockResolvedValue({ plans: [] });
    api.getEventGeofencePurposes.mockResolvedValue({ purposes: [{ code: "other", label: "Other", sort_order: 0, is_system: true }] });
    api.getMonitoringAreaTests.mockResolvedValue({ tests: [], teams_configured: true, teams_destination: "Event Operations" });
    api.addEventGeofenceRule.mockResolvedValue({});

    render(<MemoryRouter><AppDialogProvider><EventResourceMapEditor /></AppDialogProvider></MemoryRouter>);
    const user = userEvent.setup();
    // The select is in the first commit holding only its placeholder option,
    // and the areas appear when getEventGeofences resolves. Waiting on the
    // select itself - which is what `waitFor(() => expect(area)
    // .toBeInTheDocument())` did here - returns before any data has landed, so
    // every step below was racing the fetch and only passed because the poll
    // happened to let the mock's promise flush first. Wait for an option out of
    // the response instead: that is the signal the data actually arrived. It
    // has to be scoped to this select - the Monitoring Area test manager above
    // renders its own picker from the same geofences, so an unscoped query for
    // the "Area A" option matches two elements.
    const area = document.getElementById("event-geofence-rule-select") as HTMLSelectElement;
    await waitFor(() => expect(within(area).getByRole("option", { name: "Area A" })).toBeInTheDocument());
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

  it("starts a time-limited corridor Monitoring Area test in the configured Teams channel", async () => {
    api.getEventGeofences.mockResolvedValue({ geofences: [{ id: "area-a", name: "Garage Exit", purpose: "other", is_active: true, updated_at: "2026-08-22T00:00:00Z", updated_by: null, polygon: "{}", rules: [] }] });
    api.getEventLocations.mockResolvedValue({ locations: [{ id: "location-a", name: "Eagan Bus Garage", category: "other", latitude: 44.8, longitude: -93.2, notes: null, is_active: true }] });
    api.getEventServicePlans.mockResolvedValue({ plans: [] });
    api.getEventGeofencePurposes.mockResolvedValue({ purposes: [] });
    api.getMonitoringAreaTests.mockResolvedValue({ tests: [], teams_configured: true, teams_destination: "Event Operations" });
    api.startMonitoringAreaTest.mockResolvedValue({ tests: [], teams_configured: true, teams_destination: "Event Operations" });

    render(<MemoryRouter><AppDialogProvider><EventResourceMapEditor /></AppDialogProvider></MemoryRouter>);
    const user = userEvent.setup();
    const testMode = (await screen.findByText("Monitoring Area test mode")).closest("details");
    expect(testMode).not.toBeNull();
    const controls = within(testMode!);
    await user.selectOptions(controls.getByLabelText("Reference location"), "location-a");
    await user.selectOptions(controls.getByLabelText("Monitoring Area"), "area-a");
    await user.clear(controls.getByLabelText("Test duration (minutes)"));
    await user.type(controls.getByLabelText("Test duration (minutes)"), "60");
    await user.click(controls.getByRole("button", { name: "Start Monitoring Area test" }));

    await waitFor(() => expect(api.startMonitoringAreaTest).toHaveBeenCalledWith({ location_id: "location-a", geofence_id: "area-a", duration_minutes: 60 }));
  });
});
