import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeedHistory, LiveBanner, LiveSignal, signalStateFor } from "./LiveSignal.js";

afterEach(cleanup);

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
  // does not poll on a known clock must not draw one, or the indicator is
  // promising a refresh nobody scheduled.
  it("draws the countdown arc only when a real refresh clock is supplied", () => {
    const { container } = render(<LiveSignal state="live" intervalMs={30_000} secondsLeft={20} />);
    expect(container.querySelector(".live-signal-arc")).not.toBeNull();

    cleanup();
    const without = render(<LiveSignal state="live" />).container;
    expect(without.querySelector(".live-signal-arc")).toBeNull();
  });

  it("phases the arc to the real deadline rather than to when it mounted", () => {
    const { container } = render(<LiveSignal state="live" intervalMs={30_000} secondsLeft={20} />);
    const arc = container.querySelector(".live-signal-arc") as SVGCircleElement;
    expect(arc.style.animationDuration).toBe("30000ms");
    // 10s of the 30s interval has already elapsed.
    expect(arc.style.animationDelay).toBe("-10000ms");
  });

  it("never animates a countdown for a state that is not receiving data", () => {
    for (const state of ["stale", "unavailable", "locked", "connecting"] as const) {
      const { container } = render(<LiveSignal state={state} intervalMs={30_000} secondsLeft={20} />);
      expect(container.querySelector(".live-signal-arc")).toBeNull();
      cleanup();
    }
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
  // The sweep says "this page just took delivery of data". A preview or
  // training banner has no feed behind it, so it must not wear one.
  it("moves only in the live tone", () => {
    const { container } = render(<LiveBanner state="live" tone="live" badge="Live data">Receiving</LiveBanner>);
    expect(container.querySelectorAll(".live-banner-wire")).toHaveLength(2);
    expect(container.querySelector(".live-banner-sheen")).not.toBeNull();
    cleanup();

    const preview = render(<LiveBanner tone="accent" badge="Preview data">Sample</LiveBanner>).container;
    expect(preview.querySelector(".live-banner-wire")).toBeNull();
    expect(preview.querySelector(".live-signal")).toBeNull();
  });

  it("keeps the badge and message readable as text", () => {
    render(<LiveBanner state="stale" tone="warning" badge="Stale" role="status">Last arrival 19 minutes ago.</LiveBanner>);
    expect(screen.getByRole("status").textContent).toContain("Stale");
    expect(screen.getByRole("status").textContent).toContain("Last arrival 19 minutes ago.");
  });
});
