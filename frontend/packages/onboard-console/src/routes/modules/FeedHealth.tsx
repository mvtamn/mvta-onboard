import { useState } from "react";
import { ApiError, type FeedCheck, type KpiTrust } from "@mvta/shared";
import { api } from "../../config.js";
import "./serviceRisk.css";

function state(check: FeedCheck): { label: string; className: string } {
  if (!check.configured) return { label: "Not configured", className: "muted" };
  if (check.freshness === "current") return { label: "Current", className: "success" };
  if (check.freshness === "stale") return { label: "Stale", className: "warning" };
  if (check.error || !check.status || check.status >= 400) return { label: "Failed", className: "danger" };
  if ((check.records ?? 0) === 0) return { label: "Empty", className: "warning" };
  return { label: "Live", className: "success" };
}

function detail(check: FeedCheck): string {
  if (check.error) return check.error;
  if (check.last_success_at) {
    const when = new Date(check.last_success_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `Last success ${when} · ${(check.records ?? 0).toLocaleString()} records`;
  }
  return check.records === undefined ? "No count returned" : `${check.records.toLocaleString()} records`;
}

function message(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return "Sign in again to run staff feed checks.";
  if (error instanceof ApiError && error.status === 403) return "Your account does not have access to feed checks.";
  return "Feed checks could not be completed. Try again shortly.";
}

function trustDetail(stream: KpiTrust[string]): string {
  const required = stream.dependencies.filter((dependency) => dependency.required);
  const times = required
    .map((dependency) => {
      const delivery = dependency.last_success_at
        ? `received ${new Date(dependency.last_success_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "not received";
      const coverage = dependency.source_timestamp_at
        ? ` · source ${new Date(dependency.source_timestamp_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : "";
      return `${dependency.feed_name.replaceAll("_", " ")}: ${delivery}${coverage}`;
    });
  return `${stream.explanation} ${times.join("; ")}`;
}

export function FeedHealth() {
  const [checks, setChecks] = useState<FeedCheck[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [trust, setTrust] = useState<KpiTrust | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const [result, trustResult] = await Promise.all([
        api.getFeedChecks(),
        api.getKpiTrust().catch(() => null),
      ]);
      setChecks(result.checks);
      setCheckedAt(result.checked_at);
      setTrust(trustResult?.streams ?? null);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="feed-health" aria-labelledby="feed-health-title">
      <div>
        <span className="risk-eyebrow">Source verification</span>
        <h4 id="feed-health-title">Feed health</h4>
        <p>Runs a bounded, credential-safe check. No rider, driver, or location records are displayed.</p>
      </div>
      <button type="button" className="button-secondary" onClick={run} disabled={loading}>
        {loading ? "Checking…" : "Check feeds"}
      </button>
      {error && <p className="feed-health-error" role="alert">{error}</p>}
      {checks && (
        <>
          <p className="feed-health-time">Checked {new Date(checkedAt ?? "").toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
          <div className="feed-health-list" role="list" aria-label="Feed check results">
            {checks.map((check) => {
              const current = state(check);
              return (
                <div className="feed-health-row" role="listitem" key={check.name}>
                  <span>{check.name}</span>
                  <small>{detail(check)}</small>
                  <strong className={`feed-health-status ${current.className}`}>{current.label}</strong>
                </div>
              );
            })}
          </div>
          {trust && (
            <section className="feed-health-list" aria-labelledby="kpi-trust-title">
              <h4 id="kpi-trust-title">KPI trust</h4>
              <p>Current usability is derived from recorded ingestion evidence; it does not run vendor checks.</p>
              <div role="list" aria-label="KPI trust results">
                {Object.entries(trust).map(([name, stream]) => (
                  <div className="feed-health-row" role="listitem" key={name}>
                    <span>{name.replaceAll("_", " ")}</span>
                    <small>{trustDetail(stream)}</small>
                    <strong className={`feed-health-status ${stream.state === "current" ? "success" : stream.state === "current_but_empty" ? "warning" : stream.state === "stale" ? "warning" : "danger"}`}>
                      {stream.state === "current_but_empty" ? "Current · no records" : stream.state.replaceAll("_", " ")}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
