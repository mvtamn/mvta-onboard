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

function evidence(trust: KpiTrustStream): string | null {
  const oldestRequired = trust.dependencies
    .filter((dependency) => dependency.required)
    .map((dependency) => dependency.last_success_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  return oldestRequired
    ? `Last required ingestion ${new Date(oldestRequired).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
    : null;
}

export function KpiTrustSummary({ stream }: { stream: KpiTrustStreamName | KpiTrustStreamName[] }) {
  const names = Array.isArray(stream) ? stream : [stream];
  const [trust, setTrust] = useState<KpiTrustStream[]>([]);

  useEffect(() => {
    api.getKpiTrust().then(({ streams }) => setTrust(names.map((name) => streams[name]).filter((value): value is KpiTrustStream => Boolean(value)))).catch(() => setTrust([]));
  }, [names.join(",")]);

  if (!trust.length) return null;
  return (
    <>
      {trust.map((item, index) => (
        <div className={`concept-banner kpi-trust ${item.state}`} role="status" key={names[index] ?? index}>
          <span className="concept-badge">{kpiTrustStateLabel(item.state)}</span>
          <span>{item.explanation}{item.contract_pending ? " Reporting deadline pending." : ""} {evidence(item)}</span>
        </div>
      ))}
    </>
  );
}
