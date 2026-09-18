import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dashboard, triageTitle } from "./Dashboard.js";
import type { ActiveMessage, SuggestedAlert } from "@mvta/shared";
import type { LiveStats } from "../hooks/useLiveStats.js";
import type { FeedFreshness } from "../hooks/useFeedFreshness.js";

vi.mock("../components/Sidebar.js", () => ({ Sidebar: () => <aside>Health summary</aside> }));
vi.mock("../components/MessagesTable.js", () => ({ MessagesTable: () => <div>Active Service Alerts table</div> }));
const feedHealth: FeedFreshness = {
  feeds: [],
  summary: { state: "live", label: "All feeds current" },
  checkedAt: null,
  refresh: vi.fn(),
};
vi.mock("../hooks/useFeedFreshness.js", () => ({ useFeedFreshness: () => feedHealth }));

function stats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    activeCount: 0,
    activeMessages: [],
    lastMessageId: null,
    pending: [],
    subscribers: null,
    syncedAt: new Date("2026-08-16T12:00:00Z"),
    ok: true,
    activeState: "live",
    pendingState: "live",
    overallState: "live",
    refresh: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("Dashboard", () => {
  it("puts triage exceptions before supporting communications", () => {
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);

    expect(screen.getByRole("region", { name: "Triage exceptions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Triage exceptions" })).toHaveTextContent("Nothing needs triage");
    expect(screen.getByText("Active Service Alerts table")).toBeInTheDocument();
  });

  it("shows a stale trust state instead of claiming live data", () => {
    render(
      <MemoryRouter>
        <Dashboard stats={stats({ overallState: "stale", activeState: "stale" })} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Stale data");
  });

  // The bar used to say "Live data connected" whenever the API answered, even
  // with a feed hours stale or never delivered.
  it("reports the feeds, not just the API, once the API is answering", () => {
    feedHealth.summary = { state: "unavailable", label: "On-demand reconciliation not received" };
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);

    const bar = screen.getByRole("status");
    expect(bar).toHaveTextContent("On-demand reconciliation not received");
    expect(bar).not.toHaveTextContent("Live data connected");
    expect(bar.className).toContain("unavailable");
    expect(screen.getByLabelText("Dashboard summary")).toHaveTextContent("On-demand reconciliation not received");
    feedHealth.summary = { state: "live", label: "All feeds current" };
  });

  it("says all feeds are current only when the feeds say so", () => {
    render(<MemoryRouter><Dashboard stats={stats()} /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("All feeds current");
  });
});

// --- The priority queue -----------------------------------------------------

const MINUTE = 60_000;

function activeMessage(overrides: Partial<ActiveMessage> = {}): ActiveMessage {
  return {
    message_id: "m1",
    summary: "Route 470 southbound detour at Cedar Ave and 140th St",
    category: "detour",
    severity: "major",
    routes_affected: ["470", "472"],
    stops_affected: [],
    zones_affected: [],
    channels: ["sms", "email"],
    expires_at: new Date(Date.now() + 20 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - 60 * MINUTE).toISOString(),
    ...overrides,
  };
}

function suggestedAlert(overrides: Partial<SuggestedAlert> = {}): SuggestedAlert {
  return {
    alert_id: "s1",
    source: "gtfs_rt",
    draft_text: "497 EB riders: Due to construction this route will be on detour.",
    category: "detour",
    severity: "informational",
    routes_affected: ["497"],
    zones_affected: [],
    detail: null,
    status: "pending",
    created_at: new Date(Date.now() - 5 * MINUTE).toISOString(),
    reviewed_by: null,
    reviewed_at: null,
    message_id: null,
    ...overrides,
  };
}

function queueTitles(container: HTMLElement) {
  return [...container.querySelectorAll(".dashboard-queue-title")].map((el) => el.textContent ?? "");
}

describe("priority queue", () => {
  // The old ranking scored expiring alerts in milliseconds-remaining and
  // suggested alerts with constants around 1,000,000, so anything more than
  // 16m40s from expiry sorted below every suggestion in the queue.
  it("puts a rider alert going dark in 20 minutes above an informational suggestion", () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard stats={stats({ activeMessages: [activeMessage()], pending: [suggestedAlert()] })} />
      </MemoryRouter>,
    );

    const titles = queueTitles(container);
    expect(titles[0]).toContain("Route 470");
    expect(titles[1]).toContain("497 EB riders");
  });

  it("ranks an unanswering feed above every alert and suggestion", () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard
          stats={stats({
            activeMessages: [activeMessage({ expires_at: new Date(Date.now() - MINUTE).toISOString() })],
            pending: [suggestedAlert({ severity: "critical" })],
            pendingState: "unavailable",
          })}
        />
      </MemoryRouter>,
    );

    expect(queueTitles(container)[0]).toBe("Suggested Alerts is not answering");
  });

  it("ranks a critical suggestion above a minor one, oldest first within a severity", () => {
    const { container } = render(
      <MemoryRouter>
        <Dashboard
          stats={stats({
            pending: [
              suggestedAlert({ alert_id: "minor", draft_text: "Minor one.", severity: "minor" }),
              suggestedAlert({ alert_id: "newer", draft_text: "Newer critical.", severity: "critical" }),
              suggestedAlert({
                alert_id: "older",
                draft_text: "Older critical.",
                severity: "critical",
                created_at: new Date(Date.now() - 30 * MINUTE).toISOString(),
              }),
            ],
          })}
        />
      </MemoryRouter>,
    );

    expect(queueTitles(container)).toEqual(["Older critical.", "Newer critical.", "Minor one."]);
  });

  // The On-Demand wait-risk draft is ~220 characters opening with a fixed stem,
  // so on one truncated line every such row read identically.
  it("keeps the zone and the wait time of an On-Demand draft in the title", () => {
    const draft =
      "MVTA Connect customers in Zone Savage: Pickup for this trip is predicted after approximately 41 minutes, " +
      "above the 20-minute service standard. Please check for updated pickup information.";

    const { container } = render(
      <MemoryRouter>
        <Dashboard stats={stats({ pending: [suggestedAlert({ draft_text: draft, category: "demand_response_delay" })] })} />
      </MemoryRouter>,
    );

    const title = queueTitles(container)[0];
    expect(title).toContain("Zone Savage");
    expect(title).toContain("41 minutes");
    expect(title).not.toContain("Please check for updated pickup information");
  });

  it("leaves a short title alone and hard-cuts a long one with no sentence break", () => {
    expect(triageTitle("Cedar Ave. and 140th St. closed")).toBe("Cedar Ave. and 140th St. closed");
    expect(triageTitle(`  spaced   out  `)).toBe("spaced out");
    const runOn = "x".repeat(400);
    expect(triageTitle(runOn)).toHaveLength(150);
    expect(triageTitle(runOn).endsWith("…")).toBe(true);
  });

  // "Expired" used to be the action link itself, so the row offered a status
  // where it looked like it offered a verb.
  it("separates an expired alert's status from its action", () => {
    render(
      <MemoryRouter>
        <Dashboard
          // Half a minute inside the bucket: formatMinutes() ceils, so a whole 6 reads
          // as 7 as soon as the render takes a millisecond.
          stats={stats({ activeMessages: [activeMessage({ expires_at: new Date(Date.now() - 5.5 * MINUTE).toISOString() })] })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Expired 6 min ago/)).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: /^Renew or retire:/ })).toHaveAttribute("href", "/service-operations/active");
  });

  it("names each row's kind", () => {
    render(
      <MemoryRouter>
        <Dashboard
          stats={stats({ activeMessages: [activeMessage()], pending: [suggestedAlert()], activeState: "stale" })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Rider alert")).toBeInTheDocument();
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(screen.getByText("Feed")).toBeInTheDocument();
  });

  // slice(0, 5) used to drop the tail with nothing said about it.
  it("counts the exceptions it could not show", () => {
    const pending = Array.from({ length: 8 }, (_, i) =>
      suggestedAlert({ alert_id: `s${i}`, draft_text: `Suggestion ${i}.` }));

    const { container } = render(<MemoryRouter><Dashboard stats={stats({ pending })} /></MemoryRouter>);

    expect(queueTitles(container)).toHaveLength(5);
    expect(screen.getByText("Showing the 5 most urgent of 8 exceptions")).toBeInTheDocument();
  });

  it("says what it checked when the queue is empty", () => {
    render(<MemoryRouter><Dashboard stats={stats({ activeMessages: [activeMessage({ expires_at: new Date(Date.now() + 5 * 60 * MINUTE).toISOString() })] })} /></MemoryRouter>);

    const queue = screen.getByRole("region", { name: "Triage exceptions" });
    expect(queue).toHaveTextContent("Nothing needs triage");
    expect(queue).toHaveTextContent("1 rider alert is live and no suggested alerts are waiting");
  });
});
