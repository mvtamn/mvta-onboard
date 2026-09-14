import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type KpiTrust } from "@mvta/shared";
import { api } from "../config.js";
import { dashboardFeeds, summarizeFeeds, type DashboardFeed, type FeedHealthLoad, type FeedSummary } from "./feedFreshness.js";
import { useVisibleInterval } from "./useVisibleInterval.js";

export const FEED_FRESHNESS_POLL_MS = 60_000;

export interface FeedFreshness {
  feeds: DashboardFeed[];
  summary: FeedSummary;
  checkedAt: Date | null;
  refresh: () => void;
}

// Polls the feed-health ledger for the Dashboard, once a minute while the page
// is visible. The feeds behind it deliver every five minutes or more, so a
// minute is enough to show a feed going stale promptly without adding load.
export function useFeedFreshness(intervalMs = FEED_FRESHNESS_POLL_MS): FeedFreshness {
  const [streams, setStreams] = useState<KpiTrust | null>(null);
  const [load, setLoad] = useState<FeedHealthLoad>("loading");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    api
      .getKpiTrust()
      .then((response) => {
        if (!alive) return;
        setStreams(response.streams);
        setLoad("ok");
        setCheckedAt(new Date());
      })
      .catch((error) => {
        if (!alive) return;
        // The last streams stay; dashboardFeeds stops vouching for them.
        setLoad(
          error instanceof ApiError && error.status === 401 ? "authentication_required"
            : error instanceof ApiError && error.status === 403 ? "no_access"
              : "failed",
        );
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useVisibleInterval(refresh, intervalMs);

  const feeds = useMemo(() => dashboardFeeds(streams, load), [streams, load]);
  const summary = useMemo(() => summarizeFeeds(feeds), [feeds]);
  return { feeds, summary, checkedAt, refresh };
}
