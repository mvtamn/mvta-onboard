import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    setTraffic: vi.fn(),
    setStyle: vi.fn(),
    dispose: vi.fn(),
  };
  return { errorHandler: () => errorHandler, readyHandler: () => readyHandler, getMapsToken: vi.fn(), map };
});

vi.mock("azure-maps-control", () => ({
  AuthenticationType: { anonymous: "anonymous" },
  Map: vi.fn(function () { return mocks.map; }),
  Popup: vi.fn(function () { return { setOptions: vi.fn() }; }),
  source: { DataSource: vi.fn(function () { return { clear: vi.fn(), add: vi.fn() }; }) },
}));
vi.mock("../../config.js", () => ({ api: { getMapsToken: mocks.getMapsToken } }));
vi.mock("../../theme/ThemeContext.js", () => ({ useTheme: () => ({ theme: "light" }) }));

import { EventVehicleMap } from "./EventVehicleMap.js";

describe("EventVehicleMap", () => {
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
    expect(mocks.map.setStyle).not.toHaveBeenCalled();
  });
});
