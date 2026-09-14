import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedHistory, LiveBanner, LiveSignal, signalStateFor } from "./LiveSignal.js";

const SEC = 1_000;
const MIN = 60_000;
const CADENCE = 5 * MIN;
// A slot boundary on the poller's UTC grid, and "now" one minute into it.
const SLOT = Date.parse("2026-09-14T01:30:00Z");
const NOW = SLOT + MIN;
// The slot's delivery landed 20 seconds after its poll fired.
const CLOCK = { lastArrivalAt: SLOT + 20 * SEC, slotStartAt: SLOT, cadenceMs: CADENCE };
const NEXT = { lastArrivalAt: SLOT + CADENCE + 18 * SEC, slotStartAt: SLOT + CADENCE, cadenceMs: CADENCE };

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

  // Anchored to the slot on the poller's grid, so it points at the next
  // scheduled poll rather than "stamp + five minutes".
  it("counts down across the delivered slot to the next scheduled poll", () => {
    const { container } = render(<LiveSignal state="live" clock={CLOCK} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(arc.style.animationDuration).toBe(`${CADENCE}ms`);
    expect(arc.style.animationDelay).toBe(`-${MIN}ms`);
  });

  // On dev a past-due catch-up stamped the ledger at 01:27:35 for the 01:25
  // slot; "stamp + cadence" aimed the countdown at 01:32:35, not 01:30.
  it("aims at the next slot even when the delivery stamp landed late in its slot", () => {
    vi.setSystemTime(SLOT + 3 * MIN);
    const late = { lastArrivalAt: SLOT + 2 * MIN + 35 * SEC, slotStartAt: SLOT, cadenceMs: CADENCE };
    const { container } = render(<LiveSignal state="live" clock={late} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(arc.style.animationDelay).toBe(`-${3 * MIN}ms`);
  });

  it("holds the arc empty, rather than looping, once the next poll is late", () => {
    const old = { lastArrivalAt: SLOT - 2 * CADENCE + 20 * SEC, slotStartAt: SLOT - 2 * CADENCE, cadenceMs: CADENCE };
    const { container } = render(<LiveSignal state="live" clock={old} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(arc.style.animationDelay).toBe(`-${CADENCE}ms`);
  });

  it("never animates a countdown for a state that is not receiving data", () => {
    for (const state of ["stale", "unavailable", "locked", "connecting"] as const) {
      const { container } = render(<LiveSignal state={state} clock={CLOCK} />);
      expect(container.querySelector(".live-signal-arc")).toBeNull();
      cleanup();
    }
  });

  it("flashes only when a new slot delivers, not on a re-read of the same one", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    expect(container.querySelector(".live-signal-core.arrive")).toBeNull();

    rerender(<LiveSignal state="live" clock={{ ...CLOCK }} />);
    expect(container.querySelector(".live-signal-core.arrive")).toBeNull();

    rerender(<LiveSignal state="live" clock={NEXT} />);
    expect(container.querySelector(".live-signal-core.arrive")).not.toBeNull();
    expect(container.querySelector(".live-signal-bloom.arrive")).not.toBeNull();
  });

  // The defect dev showed: the banner mounts while loading with no clock and
  // receives one a second later. That first clock is the page opening, not a
  // delivery.
  it("does not flash when the delivery clock first becomes known", () => {
    const { container, rerender } = render(<LiveSignal state="live" />);
    rerender(<LiveSignal state="live" clock={CLOCK} />);
    expect(container.querySelector(".arrive")).toBeNull();

    rerender(<LiveSignal state="live" clock={NEXT} />);
    expect(container.querySelector(".live-signal-core.arrive")).not.toBeNull();
  });

  // Two pollers stamp the ledger each slot, seconds apart (288 of 288 slots on dev).
  it("does not flash again for a second stamp in a slot that already delivered", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    rerender(<LiveSignal state="live" clock={NEXT} />);
    const flashed = container.querySelector(".live-signal-core.arrive");
    expect(flashed).not.toBeNull();

    rerender(<LiveSignal state="live" clock={{ ...NEXT, lastArrivalAt: NEXT.lastArrivalAt + 9 * SEC }} />);
    // The same element, not a remount - so the one-shot animation does not replay.
    expect(container.querySelector(".live-signal-core")).toBe(flashed);
  });

  it("does not replay a flash when the signal returns to live within the same slot", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    rerender(<LiveSignal state="live" clock={NEXT} />);
    rerender(<LiveSignal state="stale" clock={NEXT} />);
    rerender(<LiveSignal state="live" clock={NEXT} />);
    expect(container.querySelector(".arrive")).toBeNull();
  });

  it("restarts the countdown when a new slot delivers", () => {
    const { container, rerender } = render(<LiveSignal state="live" clock={CLOCK} />);
    const first = container.querySelector(".live-signal-arc");
    vi.setSystemTime(SLOT + CADENCE);
    rerender(<LiveSignal state="live" clock={{ ...NEXT, lastArrivalAt: SLOT + CADENCE }} />);
    const second = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(second).not.toBe(first);
    expect(second.style.animationDelay).toBe("0ms");
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

  it("sweeps once when a new slot delivers, and holds still between deliveries", () => {
    const { container, rerender } = render(
      <LiveBanner state="live" tone="live" badge="Live data" clock={CLOCK}>Receiving</LiveBanner>,
    );
    expect(container.querySelector(".arrive")).toBeNull();

    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={{ ...CLOCK }}>Receiving</LiveBanner>);
    expect(container.querySelector(".arrive")).toBeNull();

    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={NEXT}>Receiving</LiveBanner>);
    expect(container.querySelector(".live-banner-wire.arrive")).not.toBeNull();
    expect(container.querySelector(".live-banner-sheen.arrive")).not.toBeNull();
    expect(container.querySelector(".concept-badge.arrive")).not.toBeNull();
  });

  // Exactly what a page load does on Service Risk: the banner renders muted
  // while connecting, then live with the first clock.
  it("does not sweep on page load, when the banner goes from connecting to live", () => {
    const { container, rerender } = render(
      <LiveBanner state="connecting" tone="muted" badge="Connecting">Connecting</LiveBanner>,
    );
    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={CLOCK}>Receiving</LiveBanner>);
    expect(container.querySelector(".arrive")).toBeNull();

    rerender(<LiveBanner state="live" tone="live" badge="Live data" clock={NEXT}>Receiving</LiveBanner>);
    expect(container.querySelector(".live-banner-wire.arrive")).not.toBeNull();
  });

  it("keeps the badge and message readable as text", () => {
    render(<LiveBanner state="stale" tone="warning" badge="Stale" role="status">Last arrival 19 minutes ago.</LiveBanner>);
    expect(screen.getByRole("status").textContent).toContain("Stale");
    expect(screen.getByRole("status").textContent).toContain("Last arrival 19 minutes ago.");
  });
});
