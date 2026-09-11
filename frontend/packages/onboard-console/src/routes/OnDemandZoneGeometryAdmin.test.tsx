import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnDemandZoneGeometryAdmin } from "./OnDemandZoneGeometryAdmin.js";

const listOnDemandZoneVersions = vi.fn();
const uploadOnDemandZoneArchive = vi.fn();
const activateOnDemandZoneVersion = vi.fn();

vi.mock("../config.js", () => ({ api: {
  listOnDemandZoneVersions: (...args: unknown[]) => listOnDemandZoneVersions(...args),
  uploadOnDemandZoneArchive: (...args: unknown[]) => uploadOnDemandZoneArchive(...args),
  activateOnDemandZoneVersion: (...args: unknown[]) => activateOnDemandZoneVersion(...args),
} }));

const VERSION = {
  id: "11111111-1111-1111-1111-111111111111",
  feed_version: "20260907",
  source_sha256: "a".repeat(64),
  is_active: false,
  zone_count: 2,
  imported_at: "2026-09-07T10:00:00.000Z",
  imported_by: "upload:operator@mvta.example",
  activated_at: null,
  activated_by: null,
};

describe("On-demand zone geometry administration", () => {
  beforeEach(() => {
    listOnDemandZoneVersions.mockReset().mockResolvedValue({ versions: [] });
    uploadOnDemandZoneArchive.mockReset();
    activateOnDemandZoneVersion.mockReset();
  });
  afterEach(cleanup);

  it("says the monitor has no geometry when nothing is active", async () => {
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText("No zone version is active.")).toBeInTheDocument();
  });

  it("does not warn once a version is in force", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ versions: [{ ...VERSION, is_active: true }] });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText("· In force")).toBeInTheDocument();
    expect(screen.queryByText("No zone version is active.")).not.toBeInTheDocument();
  });

  it("reports the feed version and zones an upload put into force", async () => {
    uploadOnDemandZoneArchive.mockResolvedValue({
      versionId: VERSION.id, feedVersion: "20260907", zoneCount: 2, imported: true, activated: true,
      zones: ["Central Zone, Apple Valley", "Shakopee – Prior Lake Boundaries"],
      message: "Imported and activated. The on-demand zone monitor now has geometry.",
    });
    render(<OnDemandZoneGeometryAdmin />);
    await screen.findByText("No zone version is active.");
    await userEvent.upload(
      screen.getByLabelText("GTFS-Flex archive"),
      new File(["zip"], "mvta-connect-flex.zip", { type: "application/zip" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload and import" }));
    expect(await screen.findByText(/Imported and activated/)).toHaveTextContent("Central Zone, Apple Valley");
  });

  it("surfaces the reason a wrong archive was refused, not a generic failure", async () => {
    uploadOnDemandZoneArchive.mockRejectedValue(new Error("GTFS-Flex archive is missing locations.geojson"));
    render(<OnDemandZoneGeometryAdmin />);
    await screen.findByText("No zone version is active.");
    await userEvent.upload(
      screen.getByLabelText("GTFS-Flex archive"),
      new File(["zip"], "google_transit.zip", { type: "application/zip" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Upload and import" }));
    expect(await screen.findByText(/missing locations\.geojson/)).toBeInTheDocument();
  });

  it("refuses to offer activation for a version carrying no zones", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ versions: [{ ...VERSION, zone_count: 0 }] });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByRole("button", { name: "Activate" })).toBeDisabled();
  });

  it("activates a chosen version as a deliberate, separate act", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ versions: [VERSION] });
    activateOnDemandZoneVersion.mockResolvedValue({ activated: true });
    render(<OnDemandZoneGeometryAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    await waitFor(() => expect(activateOnDemandZoneVersion).toHaveBeenCalledWith(VERSION.id));
    expect(await screen.findByText(/20260907 is now in force/)).toBeInTheDocument();
  });
});
