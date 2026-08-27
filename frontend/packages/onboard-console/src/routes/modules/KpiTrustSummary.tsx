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

export function KpiTrustSummary({ stream }: { stream: string }) {
  const [trust, setTrust] = useState<KpiTrustStream | null>(null);

  useEffect(() => {
    if (typeof api.getKpiTrust !== "function") return;
    api.getKpiTrust().then(({ streams }) => setTrust(streams[stream] ?? null)).catch(() => setTrust(null));
  }, [stream]);

  if (!trust) return null;
  return (
    <div className={`concept-banner kpi-trust ${trust.state}`} role="status">
      <span className="concept-badge">{label(trust.state)}</span>
      <span>{trust.explanation}{trust.contract_pending ? " Reporting deadline pending." : ""} {evidence(trust)}</span>
    </div>
  );
}
