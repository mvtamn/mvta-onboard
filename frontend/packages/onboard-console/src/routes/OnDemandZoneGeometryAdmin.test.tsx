import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnDemandZoneGeometryAdmin } from "./OnDemandZoneGeometryAdmin.js";

const listOnDemandZoneVersions = vi.fn();
const activateOnDemandZoneVersion = vi.fn();

vi.mock("../config.js", () => ({ api: {
  listOnDemandZoneVersions: (...args: unknown[]) => listOnDemandZoneVersions(...args),
  activateOnDemandZoneVersion: (...args: unknown[]) => activateOnDemandZoneVersion(...args),
} }));

const FEED = {
  configured: true,
  last_checked_at: "2026-09-17T09:30:07.000Z",
  last_check_succeeded: true,
  last_failure_reason: null,
  next_check_at: "2026-09-18T09:30:00.000Z",
};

const VERSION = {
  id: "11111111-1111-1111-1111-111111111111",
  feed_version: "exported-at_2026-09-17T09:30:01Z",
  source_sha256: "a".repeat(64),
  is_active: false,
  zone_count: 2,
  imported_at: "2026-09-17T09:30:07.000Z",
  imported_by: "onDemandZonesSync",
  activated_at: null,
  activated_by: null,
  last_seen_at: "2026-09-17T09:30:07.000Z",
  last_seen_feed_version: "exported-at_2026-09-17T09:30:01Z",
  unmonitored_locations: [],
};

describe("On-demand zone geometry administration", () => {
  beforeEach(() => {
    listOnDemandZoneVersions.mockReset().mockResolvedValue({ feed: FEED, versions: [] });
    activateOnDemandZoneVersion.mockReset();
  });
  afterEach(cleanup);

  it("offers no upload: zones come from the feed Spare generates", async () => {
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText(/Pulled daily from the GTFS-Flex feed Spare generates for MVTA/)).toBeInTheDocument();
    expect(screen.queryByLabelText("GTFS-Flex archive")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
  });

  it("says when the feed was last checked, that it succeeded, and when it is next checked", async () => {
    render(<OnDemandZoneGeometryAdmin />);
    const status = await screen.findByRole("group", { name: "Zone feed" });
    expect(within(status).getByText(/Last checked/)).toHaveTextContent(new Date(FEED.last_checked_at).toLocaleString());
    expect(within(status).getByText(/Last checked/)).toHaveTextContent("succeeded");
    expect(within(status).getByText(/Next check/)).toHaveTextContent(new Date(FEED.next_check_at).toLocaleString());
  });

  it("gives the reason the last check failed", async () => {
    listOnDemandZoneVersions.mockResolvedValue({
      feed: { ...FEED, last_check_succeeded: false, last_failure_reason: "GTFS-Flex feed is missing expected Operational zones" },
      versions: [],
    });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText(/failed: GTFS-Flex feed is missing expected Operational zones/)).toBeInTheDocument();
  });

  it("says the feed is not configured rather than showing a schedule", async () => {
    listOnDemandZoneVersions.mockResolvedValue({
      feed: { configured: false, last_checked_at: null, last_check_succeeded: null, last_failure_reason: null, next_check_at: null },
      versions: [],
    });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText(/The zone feed address is not configured/)).toBeInTheDocument();
    expect(screen.queryByText(/Next check/)).not.toBeInTheDocument();
  });

  it("lists the locations Spare also publishes that are not monitored", async () => {
    listOnDemandZoneVersions.mockResolvedValue({
      feed: FEED,
      versions: [{ ...VERSION, is_active: true, unmonitored_locations: [
        { id: "location_id__eagan", name: "Eagan City Boundary - REFERENCE" },
        { id: "location_id__rosemount", name: "Rosemount Pilot" },
      ] }],
    });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText(/Also published by Spare, not monitored/))
      .toHaveTextContent("Eagan City Boundary - REFERENCE; Rosemount Pilot");
  });

  it("says the monitor has no geometry when nothing is active", async () => {
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText("No zone version is active.")).toBeInTheDocument();
  });

  it("does not warn once a version is in force", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ feed: FEED, versions: [{ ...VERSION, is_active: true }] });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByText("· In force")).toBeInTheDocument();
    expect(screen.queryByText("No zone version is active.")).not.toBeInTheDocument();
  });

  it("refuses to offer activation for a version carrying no zones", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ feed: FEED, versions: [{ ...VERSION, zone_count: 0 }] });
    render(<OnDemandZoneGeometryAdmin />);
    expect(await screen.findByRole("button", { name: "Activate" })).toBeDisabled();
  });

  it("activates a chosen version as a deliberate, separate act", async () => {
    listOnDemandZoneVersions.mockResolvedValue({ feed: FEED, versions: [VERSION] });
    activateOnDemandZoneVersion.mockResolvedValue({ activated: true });
    render(<OnDemandZoneGeometryAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Activate" }));
    await waitFor(() => expect(activateOnDemandZoneVersion).toHaveBeenCalledWith(VERSION.id));
    expect(await screen.findByText(/exported-at_2026-09-17T09:30:01Z is now in force/)).toBeInTheDocument();
  });
});
