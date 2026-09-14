import type { KpiTrust, KpiTrustStream } from "@mvta/shared";
import { describe, expect, it } from "vitest";
import { dashboardFeeds, summarizeFeeds } from "./feedFreshness.js";

function stream(state: KpiTrustStream["state"], feed: string, lastSuccessAt: string | null): KpiTrustStream {
  return {
    state,
    contract_pending: false,
    explanation: "",
    dependencies: [{
      feed_name: feed, required: true, state: state === "current_but_empty" ? "current" : state,
      last_success_at: lastSuccessAt, source_timestamp_at: null, coverage_start_at: null, coverage_end_at: null,
      stale_after_minutes: 15, last_failure_at: null, last_failure_reason: null,
    }],
  };
}

// What dev returned on 2026-09-14: the TripUpdate feed current, and the
// On-Demand reconciliation never delivered because the monitor is not connected.
const DEV: KpiTrust = {
  fixed_route_delay: stream("current", "gtfs_trip_updates", "2026-09-14T05:15:00.659Z"),
  on_demand: stream("unavailable", "spare_on_demand_reconciliation", null),
};

describe("dashboardFeeds", () => {
  it("reports each feed from its own delivery, as dev showed it", () => {
    const [gtfs, connect] = dashboardFeeds(DEV, "ok");
    expect(gtfs).toMatchObject({ label: "GTFS-Realtime", state: "live", stateLabel: "Current", lastDeliveryAt: "2026-09-14T05:15:00.659Z" });
    expect(connect).toMatchObject({ label: "MVTA Connect", state: "unavailable", stateLabel: "Unavailable", lastDeliveryAt: null });
  });

  it("maps stale and current-but-empty streams", () => {
    const feeds = dashboardFeeds({
      fixed_route_delay: stream("stale", "gtfs_trip_updates", "2026-09-14T04:40:00Z"),
      on_demand: stream("current_but_empty", "spare_on_demand_reconciliation", "2026-09-14T05:00:00Z"),
    }, "ok");
    expect(feeds.map((feed) => [feed.state, feed.stateLabel])).toEqual([["stale", "Stale"], ["live", "Current · no records"]]);
  });

  it("treats a stream the API does not report as unknown, not current", () => {
    const [, connect] = dashboardFeeds({ fixed_route_delay: DEV.fixed_route_delay }, "ok");
    expect(connect).toMatchObject({ state: "unavailable", stateLabel: "Not reported" });
  });

  it("shows checking before the first answer, and unavailable if that first check fails", () => {
    expect(dashboardFeeds(null, "loading").every((feed) => feed.state === "loading")).toBe(true);
    expect(dashboardFeeds(null, "failed").every((feed) => feed.state === "unavailable")).toBe(true);
  });

  // A re-check that fails cannot vouch for data that was current a minute ago.
  it("does not keep claiming a feed is current after a re-check fails", () => {
    const [gtfs, connect] = dashboardFeeds(DEV, "failed");
    expect(gtfs).toMatchObject({ state: "stale", stateLabel: "Not rechecked", lastDeliveryAt: "2026-09-14T05:15:00.659Z" });
    expect(connect.state).toBe("unavailable");
  });

  it("shows a role without feed-health access as neutral, not broken", () => {
    expect(dashboardFeeds(null, "no_access").every((feed) => feed.state === "no_access")).toBe(true);
  });

  it("asks for sign-in when the session has lapsed", () => {
    expect(dashboardFeeds(DEV, "authentication_required").every((feed) => feed.state === "authentication-required")).toBe(true);
  });
});

describe("summarizeFeeds", () => {
  it("names the feeds behind a problem", () => {
    expect(summarizeFeeds(dashboardFeeds(DEV, "ok"))).toEqual({ state: "unavailable", label: "MVTA Connect unavailable" });
  });

  it("says all feeds are current only when every one is", () => {
    const allCurrent: KpiTrust = { ...DEV, on_demand: stream("current", "spare_on_demand_reconciliation", "2026-09-14T05:00:00Z") };
    expect(summarizeFeeds(dashboardFeeds(allCurrent, "ok"))).toEqual({ state: "live", label: "All feeds current" });
  });

  it("reports the worst state when several feeds are behind", () => {
    const summary = summarizeFeeds(dashboardFeeds({
      fixed_route_delay: stream("stale", "gtfs_trip_updates", "2026-09-14T04:40:00Z"),
      on_demand: DEV.on_demand,
    }, "ok"));
    expect(summary).toEqual({ state: "unavailable", label: "GTFS-Realtime stale · MVTA Connect unavailable" });
  });

  it("does not turn a lack of access into an alarm", () => {
    expect(summarizeFeeds(dashboardFeeds(null, "no_access"))).toEqual({ state: "loading", label: "Feed health is not available to your role" });
  });
});
