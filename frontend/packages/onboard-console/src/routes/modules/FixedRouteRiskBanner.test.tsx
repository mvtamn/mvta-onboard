import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FixedRouteRiskBanner } from "./FixedRouteServiceRisk.js";

vi.mock("../../config.js", () => ({ api: {} }));
vi.mock("../../context/FixedRouteRefreshContext.js", () => ({
  FIXED_ROUTE_REFRESH_OPTIONS: [],
  formatRefreshCountdown: (s: number) => `${s}s`,
  useFixedRouteRefresh: () => ({
    intervalMs: 30_000,
    secondsLeft: 20,
    history: [true, true, true, true, true, true],
  }),
}));

afterEach(cleanup);

function banner(diagnosticsState: string | null) {
  const { container } = render(
    <FixedRouteRiskBanner trainingMode={false} dataMode="live" diagnosticsState={diagnosticsState} message="Feed message" />,
  );
  const element = container.querySelector(".live-banner");
  if (!element) throw new Error("no banner rendered");
  return element;
}

describe("FixedRouteRiskBanner", () => {
  it("shows a current feed as live, with the sweep, countdown and poll bars", () => {
    const el = banner("current");
    expect(el.className).toContain("tone-live");
    expect(el.querySelector(".live-signal")?.className).toContain("is-live");
    expect(el.querySelector(".live-banner-wire")).not.toBeNull();
    expect(el.querySelector(".live-signal-arc")).not.toBeNull();
    expect(el.querySelectorAll(".feed-tick")).toHaveLength(6);
  });

  // Every night outside 8am-10pm the feed answers on schedule and reports
  // nothing running. That fell through to the red unavailable branch, which
  // on dev put a slashed failure glyph beside six polls that had all arrived.
  it("shows no current trips as a healthy, quiet feed rather than a failure", () => {
    const el = banner("no_current_trips");
    expect(el.className).toContain("tone-muted");
    expect(el.textContent).toContain("No active trips");
    expect(el.querySelector(".live-signal")?.className).toContain("is-live");
    expect(el.querySelector(".live-signal-arc")).not.toBeNull();
    expect(el.querySelector(".live-signal-slash")).toBeNull();
    // Quiet: no data landed for the page to own, so no sweep.
    expect(el.querySelector(".live-banner-wire")).toBeNull();
  });

  it("shows a stale feed as stale, without a countdown", () => {
    const el = banner("stale");
    expect(el.className).toContain("tone-warning");
    expect(el.querySelector(".live-signal")?.className).toContain("is-stale");
    expect(el.querySelector(".live-signal-arc")).toBeNull();
  });

  it("still shows a missing configuration as unavailable", () => {
    const el = banner("configuration_missing");
    expect(el.className).toContain("tone-danger");
    expect(el.querySelector(".live-signal-slash")).not.toBeNull();
    expect(el.querySelector(".live-banner-wire")).toBeNull();
  });
});
