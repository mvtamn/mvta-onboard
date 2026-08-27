import { useEffect, useState } from "react";
import { type KpiTrustStream } from "@mvta/shared";
import { api } from "../../config.js";

function label(state: KpiTrustStream["state"]): string {
  return state === "current_but_empty" ? "Current · no records" : state.replaceAll("_", " ");
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

export function KpiTrustSummary({ stream }: { stream: string | string[] }) {
  const names = Array.isArray(stream) ? stream : [stream];
  const [trust, setTrust] = useState<KpiTrustStream[]>([]);

  useEffect(() => {
    if (typeof api.getKpiTrust !== "function") return;
    api.getKpiTrust().then(({ streams }) => setTrust(names.map((name) => streams[name]).filter((value): value is KpiTrustStream => Boolean(value)))).catch(() => setTrust([]));
  }, [names.join(",")]);

  if (!trust.length) return null;
  return (
    <>
      {trust.map((item, index) => (
        <div className={`concept-banner kpi-trust ${item.state}`} role="status" key={names[index] ?? index}>
          <span className="concept-badge">{label(item.state)}</span>
          <span>{item.explanation}{item.contract_pending ? " Reporting deadline pending." : ""} {evidence(item)}</span>
        </div>
      ))}
    </>
  );
}
