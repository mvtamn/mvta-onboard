import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let errorHandler: (() => void) | undefined;
  let readyHandler: (() => void) | undefined;
  const map = {
    events: {
      addOnce: vi.fn((event: string, handler: () => void) => {
        if (event === "ready") readyHandler = handler;
      }),
      add: vi.fn((event: string, handler: () => void) => {
        if (event === "error") errorHandler = handler;
      }),
    },
    sources: { add: vi.fn() },
    layers: { getLayers: vi.fn(() => []), remove: vi.fn(), add: vi.fn() },
    markers: { clear: vi.fn(), add: vi.fn() },
    controls: { add: vi.fn() },
    resize: vi.fn(),
    setTraffic: vi.fn(),
    setStyle: vi.fn(),
    dispose: vi.fn(),
  };
  return { errorHandler: () => errorHandler, readyHandler: () => readyHandler, getMapsToken: vi.fn(), map };
});

vi.mock("azure-maps-control", () => ({
  AuthenticationType: { anonymous: "anonymous" },
  ControlPosition: { BottomRight: "bottom-right" },
  Map: vi.fn(function () { return mocks.map; }),
  Popup: vi.fn(function () { return { setOptions: vi.fn() }; }),
  control: {
    ZoomControl: vi.fn(function () { return { kind: "zoom" }; }),
    CompassControl: vi.fn(function () { return { kind: "compass" }; }),
  },
  source: { DataSource: vi.fn(function () { return { clear: vi.fn(), add: vi.fn() }; }) },
}));
vi.mock("../../config.js", () => ({ api: { getMapsToken: mocks.getMapsToken } }));
vi.mock("../../theme/ThemeContext.js", () => ({ useTheme: () => ({ theme: "light" }) }));

import { EventVehicleMap } from "./EventVehicleMap.js";

describe("EventVehicleMap", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows an actionable error when Azure Maps cannot initialize", async () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences={false} showLocations={false} mapStyle="road" traffic={false} />);

    await waitFor(() => expect(mocks.map.events.add).toHaveBeenCalledWith("error", expect.any(Function)));
    mocks.errorHandler()?.();

    expect(await screen.findByText(/map could not be initialised/i)).toBeInTheDocument();
  });

  it("does not reload the same style when the map becomes ready", async () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences={false} showLocations={false} mapStyle="road" traffic={false} />);

    await waitFor(() => expect(mocks.readyHandler()).toEqual(expect.any(Function)));
    act(() => mocks.readyHandler()?.());

    await waitFor(() => expect(mocks.map.setTraffic).toHaveBeenCalled());
    expect(mocks.map.controls.add).toHaveBeenCalledWith(expect.any(Array), { position: "bottom-right" });
    expect(mocks.map.setStyle).not.toHaveBeenCalled();
  });

  it("resizes after its pane finishes layout so a first paint cannot be left blank", async () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    let notify: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", vi.fn(function (callback: () => void) {
      notify = callback;
      return { observe, disconnect };
    }));

    render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences={false} showLocations={false} mapStyle="road" traffic={false} />);

    await waitFor(() => expect(mocks.readyHandler()).toEqual(expect.any(Function)));
    act(() => mocks.readyHandler()?.());
    await waitFor(() => expect(observe).toHaveBeenCalled());
    act(() => notify?.());

    await waitFor(() => expect(mocks.map.resize).toHaveBeenCalled());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("expands the live OnBoard map instead of losing its layers in an external map", () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences showLocations mapStyle="road" traffic={false} />);
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: /open larger map/i }));

    expect(view.getByRole("button", { name: "Close larger map" })).toBeInTheDocument();
    expect(container.querySelector(".evmon-real-map")).toHaveClass("is-expanded");
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps map style, traffic, Monitoring Area, and location controls on the map", () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    const onMapStyleChange = vi.fn();
    const onTrafficChange = vi.fn();
    const onShowGeofencesChange = vi.fn();
    const onShowLocationsChange = vi.fn();
    const { container } = render(<EventVehicleMap
      vehicles={[]}
      geofences={[{ id: "area-1", name: "Transit Hub", polygon: "{}", purpose: "staging", is_active: true, updated_by: null, updated_at: "2026-08-24T16:00:00.000Z" }]}
      locations={[{ id: "location-1", name: "Park and Ride", category: "park_and_ride", latitude: 44.9, longitude: -93.2, notes: null, is_active: true }]}
      showGeofences showLocations mapStyle="road" traffic={false}
      onMapStyleChange={onMapStyleChange} onTrafficChange={onTrafficChange}
      onShowGeofencesChange={onShowGeofencesChange} onShowLocationsChange={onShowLocationsChange}
    />);
    const view = within(container);

    fireEvent.change(view.getByRole("combobox", { name: "Map style" }), { target: { value: "night" } });
    fireEvent.click(view.getByRole("checkbox", { name: "Traffic" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Monitoring Areas (1)" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Locations (1)" }));

    expect(onMapStyleChange).toHaveBeenCalledWith("night");
    expect(onTrafficChange).toHaveBeenCalledWith(true);
    expect(onShowGeofencesChange).toHaveBeenCalledWith(false);
    expect(onShowLocationsChange).toHaveBeenCalledWith(false);
  });
});
