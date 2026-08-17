import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError, type EventServicePlan, type EventVehiclePosition } from "@mvta/shared";

vi.mock("../../config.js", () => ({
  api: {
    getEvents: vi.fn(),
    getEventServicePlans: vi.fn(),
    getEventGeofences: vi.fn(),
    getEventLocations: vi.fn(),
    getEventVehicleAssignments: vi.fn(),
    getEventOperationalMessaging: vi.fn(),
    getEventVehiclePositions: vi.fn(),
    getEventMonitoringHealth: vi.fn(),
    getEventGeofenceCrossings: vi.fn(),
    getEventGeofenceNotifications: vi.fn(),
    getEventAuditStream: vi.fn(),
    sendEventGeofenceNotification: vi.fn(),
    acknowledgeEventGeofenceNotification: vi.fn(),
    dismissEventGeofenceNotification: vi.fn(),
    updateEventOperationalMessaging: vi.fn(),
    createEventVehicleAssignment: vi.fn(),
    transitionEventVehicleAssignment: vi.fn(),
  },
}));

// Imported after the mock so this binding is the mocked module.
const { api } = await import("../../config.js");
const { useEventMonitoringData } = await import("./useEventMonitoringData.js");

function stubEmptyFeeds() {
  (api.getEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ events: [] });
  (api.getEventServicePlans as ReturnType<typeof vi.fn>).mockResolvedValue({ plans: [] });
  (api.getEventGeofences as ReturnType<typeof vi.fn>).mockResolvedValue({ geofences: [] });
  (api.getEventLocations as ReturnType<typeof vi.fn>).mockResolvedValue({ locations: [] });
  (api.getEventVehicleAssignments as ReturnType<typeof vi.fn>).mockResolvedValue({ assignments: [] });
  (api.getEventOperationalMessaging as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (api.getEventMonitoringHealth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (api.getEventGeofenceCrossings as ReturnType<typeof vi.fn>).mockResolvedValue({ crossings: [] });
  (api.getEventGeofenceNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [] });
  (api.getEventAuditStream as ReturnType<typeof vi.fn>).mockResolvedValue({ entries: [] });
}

function vehicle(overrides: Partial<EventVehiclePosition> = {}): EventVehiclePosition {
  return {
    vehicle_id: 101, route: 5, route_label: "Marathon Shuttle", route_category: "SpecialEvent",
    latitude: 44.9, longitude: -93.2, heading: 0, direction: null, block: null, run: null,
    operator_name: null, service_plan_names: [], service_plan_ids: [], speed_mph: null,
    report_timestamp: "2026-08-16T12:00:00.000Z", updated_at: "2026-08-16T12:00:00.000Z",
    report_age_seconds: 0, is_stale: false, is_in_active_scope: true, zone_id: null, zone_name: null, zone_purpose: null, zone_status: "Outside monitored zones",
    ...overrides,
  };
}

// Hoisted so its identity is stable across re-renders — an inline object
// literal here would be reconstructed on every render the hook triggers,
// retriggering every [account]-keyed effect in a runaway loop.
const TEST_ACCOUNT = { name: "test" };

function plan(overrides: Partial<EventServicePlan> = {}): EventServicePlan {
  return {
    id: "plan1", event_id: "evt1", name: "Race Day", status: "active",
    start_date: null, end_date: null, start_at: null, end_at: null,
    created_by: "x", created_at: "2026-01-01T00:00:00.000Z", updated_by: null, updated_at: "2026-01-01T00:00:00.000Z",
    links: [], revisions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubEmptyFeeds();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEventMonitoringData", () => {
  it("loads live vehicles and health for the selected operating context", async () => {
    (api.getEventVehiclePositions as ReturnType<typeof vi.fn>).mockResolvedValue({
      vehicles: [vehicle()], scope_exceptions: [], diagnostics: { table_ready: true, vehicle_count: 1, last_report_at: null },
    });
    (api.getEventMonitoringHealth as ReturnType<typeof vi.fn>).mockResolvedValue({ components: [], maintenance: null, counts: {} });

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT,
      canManageAssignments: false, canManageEventMessaging: false,
    }));

    await waitFor(() => expect(result.current.vehicles).not.toBeNull());
    expect(result.current.vehicles).toHaveLength(1);
    expect(result.current.authExpired).toBe(false);
    expect(result.current.message).toBeNull();
    await waitFor(() => expect(result.current.health).not.toBeNull());
  });

  it("sets authExpired only for a 401, distinguishing it from other load failures", async () => {
    (api.getEventVehiclePositions as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(401, "expired"));

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "", servicePlanId: "", account: null, canManageAssignments: false, canManageEventMessaging: false,
    }));

    await waitFor(() => expect(result.current.authExpired).toBe(true));
    expect(result.current.message).toMatch(/sign in again/i);
  });

  it("does not set authExpired for a non-401 load failure", async () => {
    (api.getEventVehiclePositions as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(503, "backend unavailable"));

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "", servicePlanId: "", account: null, canManageAssignments: false, canManageEventMessaging: false,
    }));

    await waitFor(() => expect(result.current.message).not.toBeNull());
    expect(result.current.authExpired).toBe(false);
    expect(result.current.message).not.toMatch(/sign in/i);
  });

  it("acknowledges a notification without removing it from the list", async () => {
    (api.getEventVehiclePositions as ReturnType<typeof vi.fn>).mockResolvedValue({ vehicles: [], scope_exceptions: [], diagnostics: { table_ready: true, vehicle_count: 0, last_report_at: null } });
    (api.getEventGeofenceNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [{ id: "n1", status: "pending", message_body: "Bus 101 entering geofence" }] });
    (api.acknowledgeEventGeofenceNotification as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: false, canManageEventMessaging: false,
    }));

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await act(async () => { await result.current.reviewNotification("n1", "acknowledge"); });
    expect(result.current.notifications[0].status).toBe("acknowledged");
    expect(api.acknowledgeEventGeofenceNotification).toHaveBeenCalledWith("n1");
  });

  it("dismisses a notification by removing it from the list", async () => {
    (api.getEventGeofenceNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: [{ id: "n1", status: "pending", message_body: "x" }] });
    (api.dismissEventGeofenceNotification as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: false, canManageEventMessaging: false,
    }));

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await act(async () => { await result.current.reviewNotification("n1", "dismiss"); });
    expect(result.current.notifications).toHaveLength(0);
  });

  it("labels a proposal against an active plan as a revision, and against a draft plan as direct", async () => {
    (api.createEventVehicleAssignment as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a1", status: "proposed" });

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: true, canManageEventMessaging: false,
    }));
    await waitFor(() => expect(result.current.vehicles).not.toBeNull());

    await act(async () => { await result.current.proposeAssignment(vehicle(), plan({ status: "active" })); });
    expect(result.current.assignmentMessage).toMatch(/active-plan revision/);

    await act(async () => { await result.current.proposeAssignment(vehicle(), plan({ status: "draft" })); });
    expect(result.current.assignmentMessage).toBe("Assignment proposed for the operating period.");
  });

  it("refuses to propose an assignment with no eligible target plan", async () => {
    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: true, canManageEventMessaging: false,
    }));
    await waitFor(() => expect(result.current.vehicles).not.toBeNull());

    await act(async () => { await result.current.proposeAssignment(vehicle(), undefined); });
    expect(result.current.assignmentMessage).toMatch(/select an event/i);
    expect(api.createEventVehicleAssignment).not.toHaveBeenCalled();
  });

  it("notifies the caller when an approved assignment lands in a new revision", async () => {
    (api.transitionEventVehicleAssignment as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "accepted", target: "revision", revision_id: "rev1" });
    const onAssignmentRevision = vi.fn();

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: true, canManageEventMessaging: false, onAssignmentRevision,
    }));
    await waitFor(() => expect(result.current.vehicles).not.toBeNull());

    await act(async () => { await result.current.reviewAssignment("a1", "approve"); });
    expect(onAssignmentRevision).toHaveBeenCalledWith("rev1");
  });

  it("clears live vehicles and scope exceptions on demand", async () => {
    (api.getEventVehiclePositions as ReturnType<typeof vi.fn>).mockResolvedValue({ vehicles: [vehicle()], scope_exceptions: [], diagnostics: { table_ready: true, vehicle_count: 1, last_report_at: null } });

    const { result } = renderHook(() => useEventMonitoringData({
      eventId: "evt1", servicePlanId: "plan1", account: TEST_ACCOUNT, canManageAssignments: false, canManageEventMessaging: false,
    }));
    await waitFor(() => expect(result.current.vehicles).toHaveLength(1));

    act(() => { result.current.resetLiveVehicles(); });
    expect(result.current.vehicles).toBeNull();
    expect(result.current.scopeExceptions).toEqual([]);
  });
});
