import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedHistory, LiveBanner, LiveSignal, signalStateFor } from "./LiveSignal.js";

const MIN = 60_000;
const NOW = Date.parse("2026-09-13T19:31:00-05:00");
// A delivery 1 minute ago, on a 5-minute cadence.
const CLOCK = { lastArrivalAt: NOW - MIN, cadenceMs: 5 * MIN };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function signal(container: HTMLElement): HTMLElement {
  const element = container.querySelector(".live-signal");
  if (!element) throw new Error("no signal rendered");
  return element as HTMLElement;
}

describe("signalStateFor", () => {
  it("maps every operational data state to an indicator state", () => {
    expect(signalStateFor("live")).toBe("live");
    expect(signalStateFor("loading")).toBe("connecting");
    expect(signalStateFor("stale")).toBe("stale");
    expect(signalStateFor("unavailable")).toBe("unavailable");
    expect(signalStateFor("authentication-required")).toBe("locked");
  });
});

describe("LiveSignal", () => {
  // The countdown is a claim about when data next arrives. A surface that
  // does not know the feed's delivery clock must not draw one.
  it("draws the countdown arc only when the feed's delivery clock is known", () => {
    const { container } = render(<LiveSignal state="live" clock={CLOCK} />);
    expect(container.querySelector(".live-signal-arc")).not.toBeNull();

    cleanup();
    const without = render(<LiveSignal state="live" />).container;
    expect(without.querySelector(".live-signal-arc")).toBeNull();
  });

  // The console re-reads every 30 seconds; the feed delivers every five minutes.
  // The arc counts down to the next delivery, not the next re-read.
  it("counts down over the feed's cadence, from the last real delivery", () => {
    const { container } = render(<LiveSignal state="live" clock={CLOCK} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(arc.style.animationDuration).toBe(`${5 * MIN}ms`);
    expect(arc.style.animationDelay).toBe(`-${MIN}ms`);
  });

  it("holds the arc empty, rather than looping, once the next delivery is late", () => {
    const late = { lastArrivalAt: NOW - 9 * MIN, cadenceMs: 5 * MIN };
    const { container } = render(<LiveSignal state="live" clock={late} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    // Phased to the very end of a one-shot, forwards-filled animation.
    expect(arc.style.animationDelay).toBe(`-${5 * MIN}ms`);
  });

  it("never animates a countdown for a state that is not receiving data", () => {
    for (const state of ["stale", "unavailable", "locked", "connecting"] as const) {
      const { container } = render(<LiveSignal state={state} clock={CLOCK} />);
      expect(container.querySelector(".live-signal-arc")).toBeNull();
      cleanup();
    }
  });

  // Nine in ten re-reads return the same delivery. Only a new one is an arrival.
  it("flashes only when a new delivery lands, not on load or on a re-read", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    expect(container.querySelector(".live-signal-core.arrive")).toBeNull();

    rerender(<LiveSignal state="live" clock={{ ...CLOCK }} />);
    expect(container.querySelector(".live-signal-core.arrive")).toBeNull();

    const next = { lastArrivalAt: CLOCK.lastArrivalAt + 5 * MIN, cadenceMs: CLOCK.cadenceMs };
    rerender(<LiveSignal state="live" clock={next} />);
    expect(container.querySelector(".live-signal-core.arrive")).not.toBeNull();
    expect(container.querySelector(".live-signal-bloom.arrive")).not.toBeNull();
  });

  it("restarts the countdown when a new delivery lands", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    const first = container.querySelector(".live-signal-arc");
    vi.setSystemTime(NOW + 4 * MIN);
    rerender(<LiveSignal state="live" clock={{ lastArrivalAt: NOW + 4 * MIN, cadenceMs: CLOCK.cadenceMs }} />);
    const second = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(second).not.toBe(first);
    expect(second.style.animationDelay).toBe("0ms");
  });

  it("does not flash a signal that is not live, even when the time moves", () => {
    const { container, rerender } = render(<LiveSignal state="stale" clock={CLOCK} />);
    rerender(<LiveSignal state="stale" clock={{ lastArrivalAt: NOW, cadenceMs: CLOCK.cadenceMs }} />);
    expect(container.querySelector(".arrive")).toBeNull();
  });

  // Colour and motion are both unavailable to some readers, so each state has
  // to be distinguishable by the markup the stylesheet shapes.
  it("gives each state its own class, and the two dead states their own glyph", () => {
    expect(signal(render(<LiveSignal state="live" />).container).className).toContain("is-live");
    cleanup();
    expect(signal(render(<LiveSignal state="stale" />).container).className).toContain("is-stale");
    cleanup();

    const down = render(<LiveSignal state="unavailable" />).container;
    expect(down.querySelector(".live-signal-slash")).not.toBeNull();
    cleanup();

    const locked = render(<LiveSignal state="locked" />).container;
    expect(locked.querySelector(".live-signal-keybar")).not.toBeNull();
  });

  it("is hidden from assistive technology unless it is given a label of its own", () => {
    const { container } = render(<LiveSignal state="live" />);
    expect(signal(container).getAttribute("aria-hidden")).toBe("true");

    cleanup();
    const labelled = render(<LiveSignal state="stale" label="GTFS-Realtime is stale" />).container;
    expect(signal(labelled).getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByLabelText("GTFS-Realtime is stale")).toBeTruthy();
  });
});

describe("FeedHistory", () => {
  it("says how many of the recorded polls arrived", () => {
    render(<FeedHistory outcomes={[true, true, false, true]} live />);
    expect(screen.getByLabelText("Last 4 polls: 3 arrived")).toBeTruthy();
  });

  it("renders nothing when no history has been recorded", () => {
    const { container } = render(<FeedHistory outcomes={[]} live />);
    expect(container.firstChild).toBeNull();
  });

  it("marks the most recent poll as the head only when it arrived", () => {
    const { container } = render(<FeedHistory outcomes={[true, false]} live={false} />);
    expect(container.querySelectorAll(".feed-tick.head")).toHaveLength(0);
    cleanup();

    const arrived = render(<FeedHistory outcomes={[false, true]} live />).container;
    expect(arrived.querySelectorAll(".feed-tick.head")).toHaveLength(1);
  });
});

describe("LiveBanner", () => {
  // A preview or training banner has no feed behind it, so it wears no wire.
  it("carries the sweep only in the live tone", () => {
    const { container } = render(<LiveBanner state="live" tone="live" badge="Live data" clock={CLOCK}>Receiving</LiveBanner>);
    expect(container.querySelectorAll(".live-banner-wire")).toHaveLength(2);
    expect(container.querySelector(".live-banner-sheen")).not.toBeNull();
    cleanup();

    const preview = render(<LiveBanner tone="accent" badge="Preview data">Sample</LiveBanner>).container;
    expect(preview.querySelector(".live-banner-wire")).toBeNull();
    expect(preview.querySelector(".live-signal")).toBeNull();
  });

  // The sweep used to run every six seconds whatever the feed did. It now
  // says one thing - "a delivery just landed" - and says it once.
  it("sweeps once when a delivery lands, and holds still between deliveries", () => {
    const { container, rerender } = render(
      <LiveBanner state="live" tone="live" badge="Live data" clock={CLOCK}>Receiving</LiveBanner>,
    );
    expect(container.querySelector(".arrive")).toBeNull();

    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={{ ...CLOCK }}>Receiving</LiveBanner>);
    expect(container.querySelector(".arrive")).toBeNull();

    const next = { lastArrivalAt: CLOCK.lastArrivalAt + 5 * MIN, cadenceMs: CLOCK.cadenceMs };
    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={next}>Receiving</LiveBanner>);
    expect(container.querySelector(".live-banner-wire.arrive")).not.toBeNull();
    expect(container.querySelector(".live-banner-sheen.arrive")).not.toBeNull();
    expect(container.querySelector(".concept-badge.arrive")).not.toBeNull();
  });

  it("keeps the badge and message readable as text", () => {
    render(<LiveBanner state="stale" tone="warning" badge="Stale" role="status">Last arrival 19 minutes ago.</LiveBanner>);
    expect(screen.getByRole("status").textContent).toContain("Stale");
    expect(screen.getByRole("status").textContent).toContain("Last arrival 19 minutes ago.");
  });
});
