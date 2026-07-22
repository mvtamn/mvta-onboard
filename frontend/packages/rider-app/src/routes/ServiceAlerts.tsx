import { useEffect, useMemo, useState } from "react";
import type { ActiveMessage } from "@mvta/shared";
import { api } from "../config.js";
import { AlertCard } from "../components/AlertCard.js";

const POLL_MS = 30_000;

export function ServiceAlerts() {
  const [messages, setMessages] = useState<ActiveMessage[]>([]);
  const [routeFilter, setRouteFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await api.getActiveMessages();
      setMessages(data.messages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const routes = useMemo(() => {
    const set = new Set<string>();
    messages.forEach((m) => m.routes_affected?.forEach((r) => set.add(r)));
    return [...set];
  }, [messages]);

  const filtered =
    routeFilter === "all"
      ? messages
      : messages.filter((m) => m.routes_affected?.includes(routeFilter));

  return (
    <>
      <p className="crumb">Home / Service Alerts</p>
      <h1 className="title">Service Alerts</h1>
      <p className="subtitle">
        All active delays, detours, closures, and service notices, updated in real time.
      </p>

      <div className="filterbar">
        <button
          className={"filter-chip" + (routeFilter === "all" ? " active" : "")}
          onClick={() => setRouteFilter("all")}
        >
          All routes
        </button>
        {routes.map((r) => (
          <button
            key={r}
            className={"filter-chip" + (routeFilter === r ? " active" : "")}
            onClick={() => setRouteFilter(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading active alerts&hellip;</div>
      ) : error ? (
        <div className="error">
          Couldn&rsquo;t load alerts right now ({error}).
          <button className="retry-btn" onClick={load}>
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">No active alerts right now &mdash; everything&rsquo;s running normally.</div>
      ) : (
        <>
          <p className="count">
            {filtered.length} active alert{filtered.length === 1 ? "" : "s"}
          </p>
          {filtered.map((m) => (
            <AlertCard key={m.message_id} m={m} />
          ))}
        </>
      )}
    </>
  );
}
