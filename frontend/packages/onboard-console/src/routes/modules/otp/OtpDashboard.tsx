import { useEffect, useState } from "react";
import { ApiError, type OtpMonthlyTrendPoint, type OtpMonthMeasurement } from "@mvta/shared";
import { api } from "../../../config.js";
import { type StopExclusionStatus } from "./otpData.js";
import { percentText, targetSentence, type OtpDisplayRoute } from "./otpFigures.js";
import { formatServiceMonth } from "./otpServiceMonth.js";

export function DashboardPage({
  displayRows,
  statuses,
  weatherCount,
  measurement,
  targetPct,
}: {
  displayRows: OtpDisplayRoute[];
  statuses: StopExclusionStatus[];
  weatherCount: number;
  measurement: OtpMonthMeasurement | null;
  targetPct: number;
}) {
  const approved = statuses.filter((s) => s === "approved").length;
  const rejected = statuses.filter((s) => s === "rejected").length;
  const pending = statuses.length - approved - rejected;
  // The server counts this on the official figure - fixed-route service with
  // approved exclusions removed - which is what this card has always claimed
  // to show and, until ADR 0033, never did.
  const below = measurement ? measurement.routes_below_target : displayRows.filter((r) => r.status === "below").length;
  const cards = [
    { label: "Pending review", value: pending, sub: "Flagged stops", color: "#F78E1E" },
    { label: "Approved", value: approved, sub: "Active exclusion rules", color: "#00553D" },
    { label: `Routes below ${targetPct}%`, value: below, sub: "Official departure OTP", color: "#8A1F1F" },
    { label: "Weather exclusions", value: weatherCount, sub: "Recorded, not applied", color: "#417B68" },
  ];
  return (
    <>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label} style={{ borderLeftColor: c.color }}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      {measurement ? (
        <div className="subcard empty-note" style={{ marginBottom: 16 }}>
          {targetSentence(targetPct, measurement.target_source)}{" "}
          Official {percentText(Math.round((measurement.assessable.pct ?? 0) * 1000) / 10)} of{" "}
          {measurement.assessable.departures.toLocaleString()} measured departures
          {measurement.excluded.departures > 0
            ? `, with ${measurement.excluded.departures.toLocaleString()} departures outside the standard or excluded.`
            : "."}
        </div>
      ) : null}
      <OtpTrendChart />
    </>
  );
}

function OtpTrendChart() {
  const [trend, setTrend] = useState<OtpMonthlyTrendPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOtpMonthlyTrend(6)
      .then((d) => setTrend(d.trend))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the OTP trend."));
  }, []);

  if (error) return <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>{error}</div>;
  if (trend === null) return <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>Loading trend…</div>;
  if (trend.length === 0) {
    return (
      <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>
        No monthly OTP history yet - the trend chart fills in as the Avail OTP Monthly feed
        accumulates months.
      </div>
    );
  }

  return (
    <div className="subcard">
      <h2 style={{ marginTop: 0 }}>Agency-wide OTP % trend</h2>
      <div className="otp-trend-chart">
        {trend.map((t) => {
          const pct = t.pct_ontime !== null ? Math.round(t.pct_ontime * 1000) / 10 : null;
          return (
            <div className="otp-trend-bar-col" key={t.service_month}>
              <div className="otp-trend-bar-track">
                <div
                  className={`otp-trend-bar ${pct !== null && pct < 85 ? "below" : "meets"}`}
                  style={{ height: `${pct ?? 0}%` }}
                  title={pct !== null ? `${pct}%` : "no data"}
                />
              </div>
              <div className="otp-trend-bar-label">{pct !== null ? `${pct}%` : "—"}</div>
              <div className="otp-trend-bar-month td-dim">{formatServiceMonth(t.service_month)}</div>
            </div>
          );
        })}
      </div>
      <p className="td-dim" style={{ marginTop: 8 }}>
        Percent only - no penalty-dollar figure is shown until a real contract penalty rate is
        available.
      </p>
    </div>
  );
}
