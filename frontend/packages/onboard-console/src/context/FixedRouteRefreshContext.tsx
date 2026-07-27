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
    } catch (err) {
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
        setRefreshInterval,
        refreshNow,
      }}
    >
      {children}
    </FixedRouteRefreshContext.Provider>
  );
}

export function useFixedRouteRefresh(): FixedRouteRefreshValue {
  const value = useContext(FixedRouteRefreshContext);
  if (!value) {
    throw new Error(
      "useFixedRouteRefresh must be used inside FixedRouteRefreshProvider",
    );
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
