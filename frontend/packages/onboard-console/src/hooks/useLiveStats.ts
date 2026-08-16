import { useCallback, useEffect, useState } from "react";
import { ApiError, type ActiveMessage, type SubscribersSummary, type SuggestedAlert } from "@mvta/shared";
import { api } from "../config.js";

export type OperationalDataState = "loading" | "live" | "stale" | "unavailable" | "authentication-required";

export function dataStateLabel(state: OperationalDataState): string {
  return {
    loading: "Loading live data",
    live: "Live data connected",
    stale: "Stale data",
    unavailable: "Data unavailable",
    "authentication-required": "Authentication required",
  }[state];
}

function errorState(error: unknown, previous: OperationalDataState): OperationalDataState {
  if (error instanceof ApiError && error.status === 401) return "authentication-required";
  return previous === "live" || previous === "stale" ? "stale" : "unavailable";
}

function overallState(states: OperationalDataState[]): OperationalDataState {
  const priority: OperationalDataState[] = ["authentication-required", "unavailable", "stale", "loading", "live"];
  return priority.find((state) => states.includes(state)) ?? "loading";
}

export interface LiveStats {
  activeCount: number | null;
  activeMessages?: ActiveMessage[] | null;
  lastMessageId: string | null;
  pending: SuggestedAlert[] | null; // null = endpoint unavailable (e.g. no token in mock mode)
  subscribers: SubscribersSummary | null;
  syncedAt: Date | null;
  ok: boolean;
  activeState: OperationalDataState;
  pendingState: OperationalDataState;
  overallState: OperationalDataState;
  refresh: () => void;
}

// One shared fetch for the sidebar/footer live numbers. Auth-gated endpoints
// (suggested alerts, subscriber summary) fail without a real token - e.g. in
// mock preview mode - so each section degrades to "—" independently instead of
// failing the whole sidebar. The public active-messages count always works.
export function useLiveStats(): LiveStats {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [activeMessages, setActiveMessages] = useState<ActiveMessage[] | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [pending, setPending] = useState<SuggestedAlert[] | null>(null);
  const [subscribers, setSubscribers] = useState<SubscribersSummary | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [ok, setOk] = useState(false);
  const [activeState, setActiveState] = useState<OperationalDataState>("loading");
  const [pendingState, setPendingState] = useState<OperationalDataState>("loading");
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;

    api
      .getActiveMessages()
      .then((d) => {
        if (!alive) return;
        setActiveCount(d.messages.length);
        setActiveMessages(d.messages);
        setLastMessageId(d.messages[0]?.message_id ?? null);
        setSyncedAt(new Date());
        setOk(true);
        setActiveState("live");
      })
      .catch((error) => {
        if (!alive) return;
        setOk(false);
        setActiveState((previous) => errorState(error, previous));
      });

    api
      .getSuggestedAlerts("pending")
      .then((d) => {
        if (!alive) return;
        setPending(d.alerts);
        setPendingState("live");
      })
      .catch((error) => {
        if (!alive) return;
        setPending(null);
        setPendingState((previous) => errorState(error, previous));
      });

    api
      .getSubscribersSummary()
      .then((d) => alive && setSubscribers(d.summary))
      .catch(() => alive && setSubscribers(null));

    return () => {
      alive = false;
    };
  }, [tick]);

  return {
    activeCount,
    activeMessages,
    lastMessageId,
    pending,
    subscribers,
    syncedAt,
    ok,
    activeState,
    pendingState,
    overallState: overallState([activeState, pendingState]),
    refresh,
  };
}
