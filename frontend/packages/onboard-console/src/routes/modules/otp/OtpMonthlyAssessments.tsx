import { useEffect, useState } from "react";
import { type PeriodKpiAssessment } from "@mvta/shared";
import { api } from "../../../config.js";
import { percentText, targetSentence, type OtpDisplayRoute } from "./otpFigures.js";
import { formatServiceMonth } from "./otpServiceMonth.js";
import type { OtpMonthlyResponse } from "./otpResponse.js";

export function MonthlyAssessmentsPage({
  otp,
  displayRows,
  targetPct,
}: {
  otp: OtpMonthlyResponse | null;
  displayRows: OtpDisplayRoute[];
  targetPct: number;
}) {
  const serviceMonth = otp?.diagnostics.service_month ?? null;
  const measurement = otp?.measurement ?? null;
  const [assessed, setAssessed] = useState<{ status: string; assessment: PeriodKpiAssessment | null } | null>(null);

  // What the month was actually assessed at, where it has been assessed. A
  // report never recalculates (ADR 0011), so a month with an Assessment Period
  // shows that period's stored figure rather than today's live one - they
  // differ the moment an exclusion is approved after the month was scored.
  useEffect(() => {
    if (!serviceMonth) { setAssessed(null); return; }
    let active = true;
    void (async () => {
      try {
        const { periods } = await api.getAssessmentPeriods();
        const period = periods.find((p) => p.service_month === serviceMonth);
        if (!period) { if (active) setAssessed(null); return; }
        const { assessments } = await api.getPeriodAssessments(period.id);
        if (active) setAssessed({ status: period.status, assessment: assessments.find((a) => a.code === "OTP_FIXED_ROUTE") ?? null });
      } catch {
        if (active) setAssessed(null);
      }
    })();
    return () => { active = false; };
  }, [serviceMonth]);

  const target = `${Math.round(targetPct * 10) / 10}%`;
  const officialPct = measurement?.assessable.pct !== null && measurement?.assessable.pct !== undefined
    ? Math.round(measurement.assessable.pct * 1000) / 10
    : null;

  return (
    <>
      <div className="subcard empty-note" style={{ marginBottom: 16 }}>
        {serviceMonth ? `Service month: ${formatServiceMonth(serviceMonth)}` : "No month selected."}
      </div>

      <div className="subcard" style={{ padding: "12px 16px", marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Agency figure</h2>
        {assessed?.assessment ? (
          <p>
            Assessed at <b>{assessed.assessment.metric_display}</b> ({assessed.assessment.tier_label}), from the
            assessment of this month, whose status is {assessed.status}. That figure is the one the contractor was
            shown; it is not recalculated here.
          </p>
        ) : measurement ? (
          <p>
            Provisional: this month has no assessment yet, so this is the live figure.{" "}
            <b>{percentText(officialPct)}</b> official of{" "}
            {measurement.assessable.departures.toLocaleString()} measured departures.
          </p>
        ) : (
          <p>Sample data: no month has been measured here yet, so there is no figure to show.</p>
        )}
        {measurement ? <p className="muted">{targetSentence(targetPct, measurement.target_source)}</p> : null}
      </div>

      <div className="subcard" style={{ overflow: "hidden" }}>
        <h2 style={{ padding: "12px 16px 0" }}>OTP by route (Avail OTP Monthly)</h2>
        {measurement && displayRows.length > 0 ? (
          <table className="data">
            <thead>
              <tr><th>Route</th><th>Departure events</th><th>Official OTP %</th><th>Status vs. {target}</th></tr>
            </thead>
            <tbody>
              {displayRows.map((r) => (
                <tr key={r.key}>
                  <td><span className="route-chip">RT {r.label}</span></td>
                  <td>{r.departures}</td>
                  <td>{percentText(r.officialPct)}</td>
                  <td>
                    {r.status === "below" ? <span className="pill-sm pill-danger">Below {target}</span>
                      : r.status === "meets" ? <span className="pill-sm pill-success">Meets {target}</span>
                        : <span className="muted">{r.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            The OTP Monthly feed (AVAIL_OTP_MONTHLY_URL) has not been configured or has no rows for
            this month yet, so there is nothing to assess. The sample rows on Route Summary are a preview
            of the layout only.
          </div>
        )}
      </div>
    </>
  );
}

// Real Audit Stream - built the same way the console's top-level Audit Log
// is: by querying the exclusion records themselves (GET /otp-audit-stream),
// not a separate generic log table.
