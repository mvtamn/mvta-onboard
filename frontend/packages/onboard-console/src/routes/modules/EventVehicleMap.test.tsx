import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let errorHandler: (() => void) | undefined;
  const map = {
    events: {
      addOnce: vi.fn(),
      add: vi.fn((event: string, handler: () => void) => {
        if (event === "error") errorHandler = handler;
      }),
    },
    dispose: vi.fn(),
  };
  return { errorHandler: () => errorHandler, getMapsToken: vi.fn(), map };
});

vi.mock("azure-maps-control", () => ({
  AuthenticationType: { anonymous: "anonymous" },
  Map: vi.fn(function () { return mocks.map; }),
  Popup: vi.fn(function () {}),
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
});
