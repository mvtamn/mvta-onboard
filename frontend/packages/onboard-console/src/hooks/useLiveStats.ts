import { useCallback, useEffect, useState } from "react";
import type { SubscribersSummary, SuggestedAlert } from "@mvta/shared";
import { api } from "../config.js";

export interface LiveStats {
  activeCount: number | null;
  lastMessageId: string | null;
  pending: SuggestedAlert[] | null; // null = endpoint unavailable (e.g. no token in mock mode)
  subscribers: SubscribersSummary | null;
  syncedAt: Date | null;
  ok: boolean;
  refresh: () => void;
}

// One shared fetch for the sidebar/footer live numbers. Auth-gated endpoints
// (suggested alerts, subscriber summary) fail without a real token - e.g. in
// mock preview mode - so each section degrades to "—" independently instead of
// failing the whole sidebar. The public active-messages count always works.
export function useLiveStats(): LiveStats {
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);
  const [pending, setPending] = useState<SuggestedAlert[] | null>(null);
  const [subscribers, setSubscribers] = useState<SubscribersSummary | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [ok, setOk] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;

    api
      .getActiveMessages()
      .then((d) => {
        if (!alive) return;
        setActiveCount(d.messages.length);
        setLastMessageId(d.messages[0]?.message_id ?? null);
        setSyncedAt(new Date());
        setOk(true);
      })
      .catch(() => alive && setOk(false));

    api
      .getSuggestedAlerts("pending")
      .then((d) => alive && setPending(d.alerts))
      .catch(() => alive && setPending(null));

    api
      .getSubscribersSummary()
      .then((d) => alive && setSubscribers(d.summary))
      .catch(() => alive && setSubscribers(null));

    return () => {
      alive = false;
    };
  }, [tick]);

  return { activeCount, lastMessageId, pending, subscribers, syncedAt, ok, refresh };
}
