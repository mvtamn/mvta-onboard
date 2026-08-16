import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type Event, type EventGeofence, type EventLocation, type EventServicePlan } from "@mvta/shared";
import { EventWorkspaceProvider } from "../context/EventWorkspaceContext.js";
import { EventPlanning } from "./EventPlanning.js";

vi.mock("../config.js", () => ({
  api: {
    getEvents: vi.fn(),
    getEventServicePlans: vi.fn(),
    getRouteClassification: vi.fn(),
    getEventGeofences: vi.fn(),
    getEventLocations: vi.fn(),
    createEvent: vi.fn(),
    createEventServicePlan: vi.fn(),
    updateEventServicePlan: vi.fn(),
    linkEventServicePlan: vi.fn(),
    unlinkEventServicePlan: vi.fn(),
    transitionEventServicePlan: vi.fn(),
    modifyEventServicePlan: vi.fn(),
    transitionEventServicePlanRevision: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ signIn: vi.fn(), signOut: vi.fn(), account: { name: "Test User", username: "test@mvta.com" }, roles: ["OCC.Admin"] }),
}));

// Imported after the mock so this binding is the mocked module.
const { api } = await import("../config.js");

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt1", name: "State Fair", description: null, owning_team: "OCC",
    created_by: "x", created_at: "2026-01-01T00:00:00.000Z", updated_by: null, updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePlan(overrides: Partial<EventServicePlan> = {}): EventServicePlan {
  return {
    id: "plan1", event_id: "evt1", name: "State Fair Week 1", status: "draft",
    start_date: null, end_date: null, start_at: "2026-08-11T15:00:00.000Z", end_at: "2026-08-11T16:00:00.000Z",
    created_by: "x", created_at: "2026-01-01T00:00:00.000Z", updated_by: null, updated_at: "2026-01-01T00:00:00.000Z",
    links: [], revisions: [],
    ...overrides,
  };
}

function makeGeofence(overrides: Partial<EventGeofence> = {}): EventGeofence {
  return { id: "geo1", name: "Fairgrounds Gate", polygon: "", is_active: true, updated_by: null, updated_at: "2026-01-01T00:00:00.000Z", rules: [], ...overrides };
}

type Mocks = {
  events?: Event[];
  plans?: EventServicePlan[];
  routes?: { route_id: number; route_category: string; is_active: boolean; route_label: string | null }[];
  geofences?: EventGeofence[];
  locations?: EventLocation[];
};

function mockApiData({ events = [], plans = [], routes = [], geofences = [], locations = [] }: Mocks = {}) {
  vi.mocked(api.getEvents).mockResolvedValue({ events });
  vi.mocked(api.getEventServicePlans).mockResolvedValue({ plans });
  vi.mocked(api.getRouteClassification).mockResolvedValue({ routes } as never);
  vi.mocked(api.getEventGeofences).mockResolvedValue({ geofences });
  vi.mocked(api.getEventLocations).mockResolvedValue({ locations });
}

function renderEventPlanning(initialEntries: string[] = ["/console/event-planning"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <EventWorkspaceProvider>
        <EventPlanning />
      </EventWorkspaceProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventPlanning", () => {
  it("loads and shows the selected Event once data resolves", async () => {
    mockApiData({ events: [makeEvent()] });
    renderEventPlanning(["/console/event-planning?event=evt1"]);
    expect(await screen.findByRole("combobox", { name: "Selected Event" })).toHaveValue("evt1");
  });

  describe("switching Events with unsaved operating-period edits", () => {
    async function setUpDirtyPeriod() {
      mockApiData({
        events: [makeEvent(), makeEvent({ id: "evt2", name: "Winter Market" })],
        plans: [makePlan()],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      // The input exists in the DOM immediately (selectedEventId comes from
      // the URL on first render); its value only catches up to the loaded
      // plan once data resolves and the [plan?.id] effect runs.
      const nameInput = await screen.findByDisplayValue("State Fair Week 1");
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "Edited but unsaved");
      return nameInput;
    }

    it("asks for confirmation before switching Events", async () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      await setUpDirtyPeriod();
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Selected Event" }), "evt2");
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("State Fair Week 1"));
    });

    it("stays on the original Event when the confirmation is canceled", async () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      await setUpDirtyPeriod();
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Selected Event" }), "evt2");
      expect(screen.getByRole("combobox", { name: "Selected Event" })).toHaveValue("evt1");
      expect(screen.getByRole("textbox", { name: "Operating period name" })).toHaveValue("Edited but unsaved");
    });

    it("switches Events and clears the stale period fields once confirmed", async () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      await setUpDirtyPeriod();
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Selected Event" }), "evt2");
      expect(screen.getByRole("combobox", { name: "Selected Event" })).toHaveValue("evt2");
      expect(screen.getByRole("textbox", { name: "Operating period name" })).toHaveValue("");
    });

    it("does not prompt when there are no unsaved edits", async () => {
      mockApiData({ events: [makeEvent(), makeEvent({ id: "evt2", name: "Winter Market" })] });
      renderEventPlanning(["/console/event-planning?event=evt1"]);
      await screen.findByRole("combobox", { name: "Selected Event" });
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Selected Event" }), "evt2");
      expect(window.confirm).not.toHaveBeenCalled();
    });
  });

  describe("accessible names for color-only status", () => {
    it("gives each readiness checklist item a text-based complete/missing accessible name", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "approved" })],
        geofences: [makeGeofence()],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const checklist = await screen.findByRole("group", { name: "Activation readiness" });
      expect(checklist.querySelector('[aria-label="Complete: Event selected"]')).not.toBeNull();
      expect(checklist.querySelector('[aria-label="Missing: Active SpecialEvent route linked"]')).not.toBeNull();
    });

    it("gives completed lifecycle steps a text-based accessible name, not just color", async () => {
      mockApiData({ events: [makeEvent()], plans: [makePlan({ status: "active" })] });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const stepper = await screen.findByRole("list", { name: "Operating period lifecycle" });
      const draftStep = within(stepper).getByText("Draft");
      expect(draftStep).toHaveAccessibleName("Completed step: Draft");
      const activeStep = within(stepper).getByText("Active");
      expect(activeStep).toHaveAttribute("aria-current", "step");
    });
  });

  describe("removing a linked resource", () => {
    const linkedRoute = { kind: "routes" as const, service_plan_id: "plan1", value: 12, label: "Route 12" };

    it("enables Remove for a draft/review plan and calls unlinkEventServicePlan on confirm", async () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      mockApiData({ events: [makeEvent()], plans: [makePlan({ status: "draft", links: [linkedRoute] })] });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const row = (await screen.findByText("Route 12")).closest<HTMLElement>(".event-linked-resource")!;
      const removeButton = within(row).getByRole("button", { name: "Remove" });
      expect(removeButton).toBeEnabled();
      await userEvent.click(removeButton);
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Route 12"));
      expect(api.unlinkEventServicePlan).toHaveBeenCalledWith("plan1", "routes", 12, undefined);
    });

    it("does not call unlinkEventServicePlan when the confirmation is canceled", async () => {
      vi.mocked(window.confirm).mockReturnValue(false);
      mockApiData({ events: [makeEvent()], plans: [makePlan({ status: "draft", links: [linkedRoute] })] });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const row = (await screen.findByText("Route 12")).closest<HTMLElement>(".event-linked-resource")!;
      await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
      expect(api.unlinkEventServicePlan).not.toHaveBeenCalled();
    });

    it("disables Remove for an active plan with no open revision", async () => {
      mockApiData({ events: [makeEvent()], plans: [makePlan({ status: "active", links: [linkedRoute] })] });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const row = (await screen.findByText("Route 12")).closest<HTMLElement>(".event-linked-resource")!;
      expect(within(row).getByRole("button", { name: "Remove" })).toBeDisabled();
    });

    it("enables Remove against an open revision and passes its id", async () => {
      vi.mocked(window.confirm).mockReturnValue(true);
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({
          status: "active", links: [linkedRoute],
          revisions: [{ id: "rev1", service_plan_id: "plan1", status: "draft" }],
        })],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const row = (await screen.findByText("Route 12")).closest<HTMLElement>(".event-linked-resource")!;
      const removeButton = within(row).getByRole("button", { name: "Remove" });
      expect(removeButton).toBeEnabled();
      await userEvent.click(removeButton);
      expect(api.unlinkEventServicePlan).toHaveBeenCalledWith("plan1", "routes", 12, "rev1");
    });
  });

  describe("direction-rule readiness deep link", () => {
    it("links the missing-direction-rule readiness item to the geofence's Configure page", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "approved", links: [{ kind: "geofences", service_plan_id: "plan1", value: "geo1", label: "Fairgrounds Gate" }] })],
        geofences: [makeGeofence({ id: "geo1", rules: [] })],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const checklist = await screen.findByRole("group", { name: "Activation readiness" });
      const link = within(checklist).getByRole("link", { name: "Messaging geofence configured" });
      expect(link).toHaveAttribute("href", "/admin?geofence=geo1#event-configuration");
    });

    it("does not render a link once every linked geofence already has a direction rule", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({
          status: "approved",
          links: [
            { kind: "routes", service_plan_id: "plan1", value: 12, label: "Route 12" },
            { kind: "geofences", service_plan_id: "plan1", value: "geo1", label: "Fairgrounds Gate" },
          ],
        })],
        geofences: [makeGeofence({ id: "geo1", rules: [{ id: "r1", geofence_id: "geo1", transition: "enter", heading_min: 0, heading_max: 360, destination_label: "Gate A", destination_location_id: null, message_type: "custom", send_mode: "auto", sort_order: 1 }] })],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const checklist = await screen.findByRole("group", { name: "Activation readiness" });
      expect(within(checklist).queryByRole("link")).toBeNull();
      expect(checklist.querySelector('[aria-label="Complete: Messaging geofence configured"]')).not.toBeNull();
    });

    it("keeps operational-only geofences separate while using a linked geofence with rules for messaging", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "approved", links: [
          { kind: "geofences", service_plan_id: "plan1", value: "geo1", label: "Operations Boundary" },
          { kind: "geofences", service_plan_id: "plan1", value: "geo2", label: "Message Gate" },
        ] })],
        geofences: [
          makeGeofence({ id: "geo1", name: "Operations Boundary", rules: [] }),
          makeGeofence({ id: "geo2", name: "Message Gate", rules: [{ id: "r1", geofence_id: "geo2", transition: "enter", heading_min: 0, heading_max: 360, destination_label: "Gate A", destination_location_id: null, message_type: "custom", send_mode: "auto", sort_order: 1 }] }),
        ],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      expect((await screen.findAllByText("Operations Boundary")).length).toBeGreaterThan(0);
      expect(screen.getAllByText("Message Gate").length).toBeGreaterThan(0);
      expect(screen.getByText("Operational only")).toBeInTheDocument();
      expect(screen.getByText("Messaging enabled")).toBeInTheDocument();
      expect(screen.getByLabelText("Complete: Messaging geofence configured")).toBeInTheDocument();
    });
  });

  describe("bulk resource linking", () => {
    async function setUpEditablePlanWithRoutes() {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "draft" })],
        routes: [
          { route_id: 12, route_category: "SpecialEvent", is_active: true, route_label: "Fair Shuttle" },
          { route_id: 13, route_category: "SpecialEvent", is_active: true, route_label: "Fair Express" },
        ],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      return screen.findByRole("group", { name: "Select routes" });
    }

    it("links every selected route in one action and clears the selection", async () => {
      vi.mocked(api.linkEventServicePlan).mockResolvedValue({ ok: true });
      const routeSelect = await setUpEditablePlanWithRoutes();
      await userEvent.click(within(routeSelect).getByRole("checkbox", { name: "Route 12 · Fair Shuttle" }));
      await userEvent.click(within(routeSelect).getByRole("checkbox", { name: "Route 13 · Fair Express" }));
      await userEvent.click(screen.getByRole("button", { name: "Add selected routes" }));
      expect(api.linkEventServicePlan).toHaveBeenCalledWith("plan1", "routes", 12, undefined);
      expect(api.linkEventServicePlan).toHaveBeenCalledWith("plan1", "routes", 13, undefined);
      expect(api.linkEventServicePlan).toHaveBeenCalledTimes(2);
      expect(within(routeSelect).getByRole("checkbox", { name: "Route 12 · Fair Shuttle" })).not.toBeChecked();
    });

    it("reports a partial failure without losing the resources that did succeed", async () => {
      vi.mocked(api.linkEventServicePlan).mockImplementation((_id, _kind, value) =>
        value === 13 ? Promise.reject(new ApiError(409, "Route already covered by another active Event")) : Promise.resolve({ ok: true }));
      const routeSelect = await setUpEditablePlanWithRoutes();
      await userEvent.click(within(routeSelect).getByRole("checkbox", { name: "Route 12 · Fair Shuttle" }));
      await userEvent.click(within(routeSelect).getByRole("checkbox", { name: "Route 13 · Fair Express" }));
      await userEvent.click(screen.getByRole("button", { name: "Add selected routes" }));
      const feedback = await screen.findByText(/1 failed/);
      expect(feedback).toHaveTextContent(/1 route added/);
    });

    it("skips a resource already on the plan and reports it instead of re-adding it", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "draft", links: [{ kind: "routes", service_plan_id: "plan1", value: 12, label: "Route 12" }] })],
        routes: [{ route_id: 12, route_category: "SpecialEvent", is_active: true, route_label: "Fair Shuttle" }],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const routeSelect = await screen.findByRole("group", { name: "Select routes" });
      await userEvent.click(within(routeSelect).getByRole("checkbox", { name: "Route 12 · Fair Shuttle" }));
      await userEvent.click(screen.getByRole("button", { name: "Add selected routes" }));
      expect(api.linkEventServicePlan).not.toHaveBeenCalled();
      expect(await screen.findByText(/already linked/)).toBeInTheDocument();
    });

    it("switches the guided resource canvas to the selected resource type", async () => {
      mockApiData({
        events: [makeEvent()],
        plans: [makePlan({ status: "draft" })],
        geofences: [makeGeofence()],
      });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      await userEvent.click(await screen.findByRole("button", { name: "Add geofence" }));
      expect(screen.getByRole("group", { name: "Select geofences" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add selected geofences" })).toBeDisabled();
      expect(screen.getByText("Fairgrounds Gate")).toBeInTheDocument();
    });
  });

  describe("duplicating an Event as a template", () => {
    it("pre-fills the create-Event form from the selected Event, name still editable", async () => {
      mockApiData({ events: [makeEvent({ description: "Annual state fair", owning_team: "OCC" })] });
      renderEventPlanning(["/console/event-planning?event=evt1"]);
      await userEvent.click(await screen.findByRole("button", { name: "Duplicate this Event" }));
      expect(screen.getByRole("textbox", { name: "New Event name" })).toHaveValue("State Fair");
      expect(screen.getByRole("textbox", { name: "Event description" })).toHaveValue("Annual state fair");
      expect(screen.getByRole("textbox", { name: "Owning team" })).toHaveValue("OCC");
      const nameInput = screen.getByRole("textbox", { name: "New Event name" });
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "State Fair (Winter)");
      expect(nameInput).toHaveValue("State Fair (Winter)");
    });

    it("creates a separate new Event rather than editing the original on submit", async () => {
      vi.mocked(api.createEvent).mockResolvedValue(makeEvent({ id: "evt-new", name: "State Fair (Winter)" }));
      mockApiData({ events: [makeEvent({ description: "Annual state fair", owning_team: "OCC" })] });
      renderEventPlanning(["/console/event-planning?event=evt1"]);
      await userEvent.click(await screen.findByRole("button", { name: "Duplicate this Event" }));
      const nameInput = screen.getByRole("textbox", { name: "New Event name" });
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "State Fair (Winter)");
      await userEvent.click(screen.getByRole("button", { name: "Create Event" }));
      expect(api.createEvent).toHaveBeenCalledWith({ name: "State Fair (Winter)", description: "Annual state fair", owning_team: "OCC" });
    });
  });

  describe("searchable Event select", () => {
    it("sorts Events with a still-open plan ahead of fully-completed Events", async () => {
      mockApiData({
        events: [
          makeEvent({ id: "evt-done", name: "Last Year's Fair" }),
          makeEvent({ id: "evt-open", name: "This Year's Fair" }),
        ],
        plans: [makePlan({ id: "plan-done", event_id: "evt-done", status: "completed" })],
      });
      renderEventPlanning();
      const select = await screen.findByRole("combobox", { name: "Selected Event" });
      const optionNames = within(select).getAllByRole("option").map((option) => option.textContent);
      expect(optionNames.indexOf("This Year's Fair")).toBeLessThan(optionNames.indexOf("Last Year's Fair"));
    });

    it("filters the Event options by typing a search term", async () => {
      mockApiData({ events: [makeEvent({ name: "State Fair" }), makeEvent({ id: "evt2", name: "Winter Market" })] });
      renderEventPlanning();
      await screen.findByRole("combobox", { name: "Selected Event" });
      await userEvent.type(screen.getByRole("searchbox", { name: "Search Events" }), "winter");
      const select = screen.getByRole("combobox", { name: "Selected Event" });
      const optionNames = within(select).getAllByRole("option").map((option) => option.textContent);
      expect(optionNames).toContain("Winter Market");
      expect(optionNames).not.toContain("State Fair");
    });

    it("keeps the event-select id and label so existing focus() calls still work", async () => {
      mockApiData({ events: [makeEvent()] });
      renderEventPlanning();
      const select = await screen.findByRole("combobox", { name: "Selected Event" });
      expect(select).toHaveAttribute("id", "event-select");
    });
  });

  describe("continuous planning workflow", () => {
    it("uses one next-action panel before an Event is chosen and before a period is chosen", async () => {
      mockApiData({ events: [makeEvent()] });
      renderEventPlanning();
      const noEventBanner = await screen.findByText("Select an Event", { selector: "strong" });
      expect(noEventBanner.closest(".event-next-action")).toHaveTextContent(/choose the Event/i);
      expect(noEventBanner.closest(".event-next-action")).not.toBeNull();

      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Selected Event" }), "evt1");
      const noPeriodBanner = await screen.findByText("Create an operating period", { selector: "strong" });
      expect(noPeriodBanner.closest(".event-next-action")).toHaveTextContent(/operating period/i);
      expect(noPeriodBanner.closest(".event-next-action")).not.toBeNull();
    });
  });

  describe("operating-period workflow order", () => {
    it("places the scope builder before review and activation", async () => {
      mockApiData({ events: [makeEvent()], plans: [makePlan()] });
      renderEventPlanning(["/console/event-planning?event=evt1&plan=plan1"]);
      const page = await screen.findByText("Operating scope builder");
      const workspace = page.closest(".event-planning")!;
      expect(workspace.querySelector("#planned-operating-resources")).not.toBeNull();
      expect(workspace.querySelector("#operating-period-lifecycle")).not.toBeNull();
      expect(workspace.querySelector("#planned-operating-resources")!.compareDocumentPosition(workspace.querySelector("#operating-period-lifecycle")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText("Scope resources")).toBeInTheDocument();
      expect(screen.getByText("Activation gate")).toBeInTheDocument();
    });
  });
});
