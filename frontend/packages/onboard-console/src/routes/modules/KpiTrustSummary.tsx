import { useEffect, useState } from "react";
import { type KpiTrustStream, type KpiTrustStreamName } from "@mvta/shared";
import { api } from "../../config.js";

// Shared with the Admin feed-health view so one trust state reads the same way
// wherever an operator meets it.
export function kpiTrustStateLabel(state: KpiTrustStream["state"]): string {
  return state === "current_but_empty" ? "Current · no records" : state.replaceAll("_", " ");
}

export function kpiTrustStateTone(state: KpiTrustStream["state"]): "success" | "warning" | "danger" {
  if (state === "current") return "success";
  if (state === "current_but_empty" || state === "stale") return "warning";
  return "danger";
}

// ISO-8601 sorts lexicographically in chronological order, so the raw value is
// what gets compared - across streams too. The formatted label must never be
// sorted: "Sep 4, 11:00 AM" precedes "Sep 4, 9:00 AM" as text, and month names
// order alphabetically.
function oldestRequiredIngestion(streams: readonly KpiTrustStream[]): string | null {
  return streams
    .flatMap((trust) => trust.dependencies)
    .filter((dependency) => dependency.required)
    .map((dependency) => dependency.last_success_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
}

function ingestionLabel(iso: string | null): string | null {
  return iso
    ? `Last required ingestion ${new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
    : null;
}

function evidence(trust: KpiTrustStream): string | null {
  return ingestionLabel(oldestRequiredIngestion([trust]));
}

// Streams are named for the contract, not for a reader. A module showing two
// of them printed the same sentence twice with nothing to tell them apart.
const STREAM_LABELS: Record<KpiTrustStreamName, string> = {
  fixed_route_delay: "Fixed route delays",
  fixed_route_departures: "Fixed route departures",
  on_demand_departures: "On-demand departures",
  otp: "OTP",
  event_avl: "Event AVL",
  on_demand: "On-demand",
  fixed_route_missed_trips: "Fixed route",
  spare_missed_trips: "On-demand",
};

export function KpiTrustSummary({ stream }: { stream: KpiTrustStreamName | KpiTrustStreamName[] }) {
  const names = Array.isArray(stream) ? stream : [stream];
  const [trust, setTrust] = useState<KpiTrustStream[]>([]);
  const [resolved, setResolved] = useState<KpiTrustStreamName[]>([]);

  useEffect(() => {
    api.getKpiTrust()
      .then(({ streams }) => {
        const present = names.filter((name) => Boolean(streams[name]));
        setResolved(present);
        setTrust(present.map((name) => streams[name] as KpiTrustStream));
      })
      .catch(() => {
        setResolved([]);
        setTrust([]);
      });
  }, [names.join(",")]);

  if (!trust.length) return null;

  // A banner costs the reader attention, so it has to carry something worth
  // reading. When every stream a module depends on is current there is one
  // fact - "they are current" - and printing it once per stream teaches staff
  // to skip this region, which is exactly when a real warning stops landing.
  // Anything other than all-current keeps a banner per stream, labelled, so a
  // reader can tell which one changed.
  const allCurrent = trust.every((item) => item.state === "current" && !item.contract_pending);
  if (allCurrent) {
    const oldest = ingestionLabel(oldestRequiredIngestion(trust));
    return (
      <div className="concept-banner kpi-trust current" role="status">
        <span className="concept-badge">current</span>
        <span>Required feed dependencies are current. {oldest}</span>
      </div>
    );
  }

  return (
    <>
      {trust.map((item, index) => {
        const name = resolved[index];
        const label = name ? STREAM_LABELS[name] : null;
        return (
          <div className={`concept-banner kpi-trust ${item.state}`} role="status" key={name ?? index}>
            <span className="concept-badge">{kpiTrustStateLabel(item.state)}</span>
            <span>{label ? `${label}: ` : ""}{item.explanation}{item.contract_pending ? " Reporting deadline pending." : ""} {evidence(item)}</span>
          </div>
        );
      })}
    </>
  );
}
