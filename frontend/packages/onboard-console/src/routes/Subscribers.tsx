import { useEffect, useState } from "react";
import type { MaskedSubscriber, SubscribersSummary } from "@mvta/shared";
import { api } from "../config.js";

// Subscribers overview. Counts for any staff role; the recent-signups list is
// Admin-only and arrives PII-masked from the API (full contact details never
// leave the server).
export function Subscribers() {
  const [summary, setSummary] = useState<SubscribersSummary | null>(null);
  const [recent, setRecent] = useState<MaskedSubscriber[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getSubscribersSummary()
      .then((d) => {
        if (!alive) return;
        setSummary(d.summary);
        setRecent(d.recent ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load."));
    return () => {
      alive = false;
    };
  }, []);

  const cards = summary
    ? [
        { label: "TOTAL", value: summary.total, sub: "All subscribers", color: "#00553D" },
        { label: "SMS CONFIRMED", value: summary.sms_confirmed, sub: "Double opt-in complete", color: "#F78E1E" },
        { label: "EMAIL CONFIRMED", value: summary.email_confirmed, sub: "Link confirmed", color: "#417B68" },
        { label: "PENDING", value: summary.pending, sub: "Awaiting confirmation", color: "#8A8A82" },
      ]
    : [];

  return (
    <>
      <div className="panel-header">Subscribers</div>
      <div className="panel-body">
        {error ? <p className="error-text">{error} (requires staff sign-in)</p> : null}
        {summary ? (
          <div className="stat-grid">
            {cards.map((c) => (
              <div className="stat-card" key={c.label} style={{ borderLeftColor: c.color }}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value">{c.value.toLocaleString()}</div>
                <div className="stat-sub">{c.sub}</div>
              </div>
            ))}
          </div>
        ) : !error ? (
          <p className="muted">Loading…</p>
        ) : null}

        {recent ? (
          <>
            <div className="side-label">Recent signups (PII masked)</div>
            {recent.length === 0 ? (
              <p className="empty-note">No subscribers yet.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr><th>Phone</th><th>Email</th><th>Status</th><th>Email status</th></tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.subscriber_id}>
                      <td>{s.phone_masked ?? "—"}</td>
                      <td>{s.email_masked ?? "—"}</td>
                      <td>
                        <span className={`pill-sm ${s.status === "confirmed" ? "pill-success" : s.status === "opted_out" ? "pill-muted" : "pill-warning"}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="td-dim">{s.email_status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : summary ? (
          <p className="muted">Recent-signup detail is visible to OCC.Admin only.</p>
        ) : null}
      </div>
    </>
  );
}
