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
  const dataSource = vi.fn(function () { return { clear: vi.fn(), add: vi.fn() }; });
  return { errorHandler: () => errorHandler, readyHandler: () => readyHandler, getMapsToken: vi.fn(), map, dataSource };
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
  source: { DataSource: mocks.dataSource },
  layer: {
    BubbleLayer: vi.fn(function () { return { kind: "bubble" }; }),
    SymbolLayer: vi.fn(function () { return { kind: "symbol" }; }),
  },
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

  it("clusters nearby buses natively until the operator zooms in", async () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences={false} showLocations={false} mapStyle="road" traffic={false} />);

    await waitFor(() => expect(mocks.readyHandler()).toEqual(expect.any(Function)));
    act(() => mocks.readyHandler()?.());

    await waitFor(() => expect(mocks.dataSource).toHaveBeenCalledWith("event-vehicles", expect.objectContaining({ cluster: true, clusterRadius: 48, clusterMaxZoom: 13 })));
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

  it("opens the live OnBoard field view in a separate window", () => {
    mocks.getMapsToken.mockResolvedValue({ client_id: "maps-client", access_token: "token" });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<EventVehicleMap vehicles={[]} geofences={[]} locations={[]} showGeofences showLocations mapStyle="road" traffic={false} largerMapUrl="/console/events/avl/field?event=event-1&plan=plan-1" />);
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: /open field window/i }));

    expect(open).toHaveBeenCalledWith(
      "/console/events/avl/field?event=event-1&plan=plan-1",
      "_blank",
      "popup,width=1600,height=1000,noopener,noreferrer",
    );
  });

  it("keeps map style, vehicle, traffic, Monitoring Area, and location controls on the map", () => {
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
    const nonEventBuses = view.getByRole("checkbox", { name: "Show non-event buses" });
    expect(nonEventBuses).not.toBeChecked();
    fireEvent.click(nonEventBuses);
    expect(nonEventBuses).toBeChecked();
    fireEvent.click(view.getByRole("checkbox", { name: "Monitoring Areas (1)" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Locations (1)" }));

    expect(onMapStyleChange).toHaveBeenCalledWith("night");
    expect(onTrafficChange).toHaveBeenCalledWith(true);
    expect(onShowGeofencesChange).toHaveBeenCalledWith(false);
    expect(onShowLocationsChange).toHaveBeenCalledWith(false);
  });
});
