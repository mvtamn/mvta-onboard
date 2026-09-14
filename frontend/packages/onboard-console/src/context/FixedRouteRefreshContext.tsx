import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TripDelay, TripDelayDiagnostics } from "@mvta/shared";
import { api } from "../config.js";
import { arrivalClock, arrivalHistory, recordArrival, type ArrivalClock } from "./feedArrivals.js";

const INTERVAL_STORAGE_KEY = "mvta-onboard-fixed-route-refresh-interval-ms";
const NEXT_REFRESH_STORAGE_KEY = "mvta-onboard-fixed-route-next-refresh-at";
const DEFAULT_INTERVAL_MS = 30_000;

export const FIXED_ROUTE_REFRESH_OPTIONS = [
  { value: 15_000, label: "Every 15 seconds" },
  { value: 30_000, label: "Every 30 seconds" },
  { value: 60_000, label: "Every minute" },
  { value: 300_000, label: "Every 5 minutes" },
] as const;

interface FixedRouteSnapshot {
  delays: TripDelay[];
  diagnostics: TripDelayDiagnostics | null;
}

interface FixedRouteRefreshValue {
  snapshot: FixedRouteSnapshot | null;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  intervalMs: number;
  secondsLeft: number;
  lastCompletedAt: Date | null;
  // The feed's own delivery clock - its last successful delivery and the
  // poller's cadence - or null while either is unknown. The indicator counts
  // down and flashes on this, not on the console's re-reads above, which
  // return the same data nine times in ten.
  arrivalClock: ArrivalClock | null;
  // The last feed deliveries as poll bars, oldest first: true for a delivery,
  // false for a slot on the cadence where none arrived.
  history: boolean[];
  setRefreshInterval: (intervalMs: number) => void;
  refreshNow: () => void;
}

const FixedRouteRefreshContext = createContext<FixedRouteRefreshValue | null>(null);

function readStoredInterval(): number {
  const stored = Number(window.localStorage.getItem(INTERVAL_STORAGE_KEY));
  return FIXED_ROUTE_REFRESH_OPTIONS.some((option) => option.value === stored)
    ? stored
    : DEFAULT_INTERVAL_MS;
}

function readStoredDeadline(intervalMs: number): number {
  const stored = Number(window.localStorage.getItem(NEXT_REFRESH_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : Date.now() + intervalMs;
}

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export function FixedRouteRefreshProvider({ children }: { children: ReactNode }) {
  const [intervalMs, setIntervalMs] = useState(readStoredInterval);
  const nextRefreshAt = useRef(readStoredDeadline(intervalMs));
  const requestInFlight = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    secondsUntil(nextRefreshAt.current),
  );
  const [snapshot, setSnapshot] = useState<FixedRouteSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<Date | null>(null);
  // Distinct delivery times seen while this console is open.
  const [arrivals, setArrivals] = useState<number[]>([]);
  const [cadenceMs, setCadenceMs] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const result = await api.getTripDelays();
      setSnapshot({
        delays: result.delays,
        diagnostics: result.diagnostics ?? null,
      });
      setError(null);
      setLastCompletedAt(new Date());
      // A worker still on the previous build answers without these; the
      // clock then stays as it was rather than guessing.
      const pollMinutes = result.diagnostics?.poll_interval_minutes;
      const cadence = typeof pollMinutes === "number" && pollMinutes > 0 ? pollMinutes * 60_000 : null;
      if (cadence !== null) setCadenceMs(cadence);
      // Recorded against the cadence from the same response, so a second
      // poller's stamp or a catch-up run in an already-delivered slot is not
      // counted as another delivery.
      const deliveredAt = Date.parse(result.diagnostics?.feed_last_success_at ?? "");
      if (Number.isFinite(deliveredAt)) setArrivals((previous) => recordArrival(previous, deliveredAt, cadence));
    } catch (err) {
      // A failed re-read says nothing about the feed. It fills no bar and
      // empties none; a feed that has actually stopped shows up as missed
      // deliveries on its own cadence.
      setError(err);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleNext = useCallback((selectedIntervalMs: number) => {
    nextRefreshAt.current = Date.now() + selectedIntervalMs;
    window.localStorage.setItem(
      NEXT_REFRESH_STORAGE_KEY,
      String(nextRefreshAt.current),
    );
    setSecondsLeft(Math.ceil(selectedIntervalMs / 1000));
  }, []);

  const setRefreshInterval = useCallback(
    (selectedIntervalMs: number) => {
      if (
        !FIXED_ROUTE_REFRESH_OPTIONS.some(
          (option) => option.value === selectedIntervalMs,
        )
      ) {
        return;
      }
      setIntervalMs(selectedIntervalMs);
      window.localStorage.setItem(
        INTERVAL_STORAGE_KEY,
        String(selectedIntervalMs),
      );
      scheduleNext(selectedIntervalMs);
    },
    [scheduleNext],
  );

  const refreshNow = useCallback(() => {
    scheduleNext(intervalMs);
    void load();
  }, [intervalMs, load, scheduleNext]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      if (now >= nextRefreshAt.current) {
        const elapsedIntervals =
          Math.floor((now - nextRefreshAt.current) / intervalMs) + 1;
        nextRefreshAt.current += elapsedIntervals * intervalMs;
        window.localStorage.setItem(
          NEXT_REFRESH_STORAGE_KEY,
          String(nextRefreshAt.current),
        );
        void load();
      }
      setSecondsLeft(secondsUntil(nextRefreshAt.current));
    };

    tick();
    const tickId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(tickId);
  }, [intervalMs, load]);

  return (
    <FixedRouteRefreshContext.Provider
      value={{
        snapshot,
        error,
        loading,
        refreshing,
        intervalMs,
        secondsLeft,
        lastCompletedAt,
        // Recomputed on every render, and the provider re-renders each second
        // with the countdown, so an overdue delivery empties a bar on time.
        arrivalClock: arrivalClock(arrivals, cadenceMs),
        history: arrivalHistory(arrivals, cadenceMs, Date.now()),
        setRefreshInterval,
        refreshNow,
      }}
    >
      {children}
    </FixedRouteRefreshContext.Provider>
  );
}

// Fails soft rather than throwing: FixedRouteRefreshIndicator is a decorative
// header widget, not critical UI, so a missing provider (its only real-world
// cause seen so far: a Vite Fast Refresh module reload swapping this file's
// createContext() identity mid-session while the already-mounted Provider
// still held the old one) should degrade to a static, harmless display
// instead of crashing the whole header. Still warns loudly in dev so a
// genuine "used outside the provider" mistake stays visible.
const FALLBACK_VALUE: FixedRouteRefreshValue = {
  snapshot: null,
  error: null,
  loading: false,
  refreshing: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  secondsLeft: 0,
  lastCompletedAt: null,
  arrivalClock: null,
  history: [],
  setRefreshInterval: () => {},
  refreshNow: () => {},
};

export function useFixedRouteRefresh(): FixedRouteRefreshValue {
  const value = useContext(FixedRouteRefreshContext);
  if (!value) {
    console.warn(
      "useFixedRouteRefresh: no FixedRouteRefreshProvider found in the tree (or its context identity changed, e.g. a dev Fast Refresh reload) - falling back to a static display instead of crashing.",
    );
    return FALLBACK_VALUE;
  }
  return value;
}

export function formatRefreshCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainder).padStart(2, "0")}`
    : `${remainder}s`;
}
