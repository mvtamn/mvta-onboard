import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KpiTrustStream } from "@mvta/shared";
import { api } from "../../config.js";
import { KPI_TRUST_STREAMS, KpiTrustSummary } from "./KpiTrustSummary.js";

vi.mock("../../config.js", () => ({ api: { getKpiTrust: vi.fn() } }));

function stream(
  state: KpiTrustStream["state"],
  lastSuccessAt: string,
  explanation = "Required feed dependencies are current.",
): KpiTrustStream {
  return {
    state,
    contract_pending: false,
    explanation,
    dependencies: [{
      feed_name: "gtfs_trip_updates", required: true, state,
      last_success_at: lastSuccessAt, source_timestamp_at: lastSuccessAt,
      coverage_start_at: null, coverage_end_at: null, stale_after_minutes: 15,
      last_failure_at: null, last_failure_reason: null,
    }],
  } as KpiTrustStream;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KpiTrustSummary", () => {
  it("collapses two healthy streams into a single banner", async () => {
    // Missed Trips renders both missed-trip streams. Printing one banner per
    // stream produced the same sentence twice, distinguishable only by a
    // timestamp - which reads as a bug and trains staff to skip the region.
    vi.mocked(api.getKpiTrust).mockResolvedValue({
      checked_at: "2026-09-04T16:00:00Z",
      streams: {
        fixed_route_missed_trips: stream("current", "2026-09-04T16:10:00Z"),
        spare_missed_trips: stream("current", "2026-09-04T16:03:00Z"),
      },
    } as never);

    render(<KpiTrustSummary stream={["fixed_route_missed_trips", "spare_missed_trips"]} />);

    const banners = await screen.findAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain("Required feed dependencies are current.");
  });

  it("reports the oldest ingestion across the collapsed streams, chronologically", async () => {
    // 9:00 AM must win over 11:00 AM. Sorting the formatted labels would pick
    // "11:00 AM" instead, because that comparison is lexicographic.
    vi.mocked(api.getKpiTrust).mockResolvedValue({
      checked_at: "2026-09-04T16:00:00Z",
      streams: {
        fixed_route_missed_trips: stream("current", "2026-09-04T11:00:00Z"),
        spare_missed_trips: stream("current", "2026-09-04T09:00:00Z"),
      },
    } as never);

    render(<KpiTrustSummary stream={["fixed_route_missed_trips", "spare_missed_trips"]} />);

    const banner = (await screen.findAllByRole("status"))[0];
    const oldest = new Date("2026-09-04T09:00:00Z")
      .toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(banner.textContent).toContain(oldest);
  });

  it("keeps a banner per stream, named, once one is not current", async () => {
    vi.mocked(api.getKpiTrust).mockResolvedValue({
      checked_at: "2026-09-04T16:00:00Z",
      streams: {
        fixed_route_missed_trips: stream("current", "2026-09-04T16:10:00Z"),
        spare_missed_trips: stream("stale", "2026-09-04T10:00:00Z", "A required feed dependency is beyond its freshness contract."),
      },
    } as never);

    render(<KpiTrustSummary stream={["fixed_route_missed_trips", "spare_missed_trips"]} />);

    const banners = await screen.findAllByRole("status");
    expect(banners).toHaveLength(2);
    expect(banners[0].textContent).toContain("Fixed route missed trips:");
    expect(banners[1].textContent).toContain("On-demand missed trips:");
    expect(banners[1].textContent).toContain("beyond its freshness contract");
  });

  it("renders a single unlabelled banner for a single healthy stream", async () => {
    // A caller that asks for one stream already knows which one it is; the
    // label would be noise there.
    vi.mocked(api.getKpiTrust).mockResolvedValue({
      checked_at: "2026-09-04T16:00:00Z",
      streams: { fixed_route_delay: stream("current", "2026-09-04T16:10:00Z") },
    } as never);

    render(<KpiTrustSummary stream="fixed_route_delay" />);

    const banners = await screen.findAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).not.toContain("Fixed route delays:");
  });

  it("labels every stream distinctly when the Admin page shows them all", async () => {
    // The banners sit together on Integrations & Data Health, with no module
    // around them to say which KPI each one is about. Two streams sharing a
    // label ("On-demand" for both wait times and missed trips) would leave an
    // administrator unable to tell which of the two had gone stale.
    const streams = Object.fromEntries(
      KPI_TRUST_STREAMS.map((name) => [name, stream("stale", "2026-09-04T10:00:00Z", "A required feed dependency is beyond its freshness contract.")]),
    );
    vi.mocked(api.getKpiTrust).mockResolvedValue({ checked_at: "2026-09-04T16:00:00Z", streams } as never);

    render(<KpiTrustSummary stream={KPI_TRUST_STREAMS} />);

    const banners = await screen.findAllByRole("status");
    expect(banners).toHaveLength(KPI_TRUST_STREAMS.length);
    const labels = banners.map((banner) => banner.textContent?.split(":")[0]?.replace(/^stale/, "").trim());
    expect(new Set(labels).size).toBe(KPI_TRUST_STREAMS.length);
    expect(labels).toContain("On-demand wait times");
    expect(labels).toContain("On-demand missed trips");
  });
});
