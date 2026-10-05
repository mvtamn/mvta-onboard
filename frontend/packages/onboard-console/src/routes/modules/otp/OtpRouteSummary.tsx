import { useState } from "react";
import { type OtpMonthMeasurement } from "@mvta/shared";
import { percentText, targetSentence, type OtpDisplayRoute } from "./otpFigures.js";
import { OtpStopChart } from "./OtpStopChart.js";

export function RouteSummaryPage({
  displayRows,
  targetPct,
  measurement,
  serviceMonth,
}: {
  displayRows: OtpDisplayRoute[];
  targetPct: number;
  measurement: OtpMonthMeasurement | null;
  /** The month the measurement is for; null on sample data, which has no stops. */
  serviceMonth: string | null;
}) {
  const target = `${Math.round(targetPct * 10) / 10}%`;
  // Which route's stops are open. Sample rows are keyed by label, not route ID,
  // and have no stops behind them, so the drill-down is live data only.
  const [openRoute, setOpenRoute] = useState<OtpDisplayRoute | null>(null);
  const canDrill = Boolean(measurement && serviceMonth);
  const open = canDrill && openRoute && displayRows.some((r) => r.key === openRoute.key) ? openRoute : null;
  return (
    <>
      <div className="subcard empty-note" style={{ marginBottom: 16 }}>
        {measurement ? (
          <>
            {targetSentence(targetPct, measurement.target_source)} Official Departure OTP is fixed-route service
            only, with approved stop exclusions removed.
          </>
        ) : (
          "Sample data: no exclusions or route classification sit behind these rows, so only the raw figure is shown. The official figure appears once the OTP Monthly feed has rows for the month."
        )}
      </div>
      {open ? (
        <OtpStopChart
          routeId={Number(open.key)}
          routeLabel={open.label}
          serviceMonth={serviceMonth!}
          measurement={measurement}
          onClose={() => setOpenRoute(null)}
        />
      ) : null}
      <div className="subcard" style={{ overflow: "hidden" }}>
        <table className="data">
          <thead>
            <tr><th>Route</th><th>Departure events</th><th>Raw OTP %</th><th>Official OTP %</th><th>Δ from exclusions</th><th>Status vs. {target}</th></tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.key}>
                <td>
                  {canDrill ? (
                    <button
                      type="button"
                      className="otp-route-btn"
                      aria-expanded={open?.key === r.key}
                      onClick={() => setOpenRoute(open?.key === r.key ? null : r)}
                    >
                      <span className="route-chip">RT {r.label}</span>
                      <span className="otp-route-hint">{open?.key === r.key ? "Hide stops" : "Stops"}</span>
                    </button>
                  ) : <span className="route-chip">RT {r.label}</span>}
                </td>
                <td>{r.departures}</td>
                <td>{percentText(r.rawPct)}</td>
                <td><b>{percentText(r.officialPct)}</b></td>
                <td className={(r.deltaPoints ?? 0) > 0 ? "ok-text" : "muted"}>
                  {r.deltaPoints === null ? "—" : `${r.deltaPoints > 0 ? "+" : ""}${r.deltaPoints} pts`}
                </td>
                <td>
                  {r.status === "below" ? <span className="pill-sm pill-danger">Below {target}</span>
                    : r.status === "meets" ? <span className="pill-sm pill-success">Meets {target}</span>
                      : <span className="muted">{r.note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
