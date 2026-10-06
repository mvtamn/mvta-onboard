import { useEffect, useState } from "react";
import { ApiError, type OtpMonthMeasurement, type OtpRouteStops } from "@mvta/shared";
import { api } from "../../../config.js";
import { percentText } from "./otpFigures.js";
import { stopBarLabel, stopBars, type StopBar } from "./otpStops.js";

// Route Summary's timepoint drill-down: one stacked bar per stop, worst first, with
// the month's target as a line the on-time segment reads against. Hand-rolled
// like the trend chart and the adherence strip; there is no chart dependency.

/** Long routes open on their worst stops; the rest are one click away. */
const FIRST_SHOWN = 15;

function Bar({ bar, targetPct }: { bar: StopBar; targetPct: number }) {
  const { ontime, early, late, other } = bar.segments;
  return (
    <li className={`otp-stop-row ${bar.kind}`} aria-label={stopBarLabel(bar)}>
      <div className="otp-stop-name" title={bar.name}>
        <span>{bar.name}</span>
        <span className="otp-stop-sub">{bar.departures} dep.{bar.note ? ` · ${bar.note}` : ""}</span>
      </div>
      <div className="otp-stop-track" aria-hidden="true">
        <span className="seg ontime" style={{ width: `${ontime * 100}%` }} />
        <span className="seg early" style={{ width: `${early * 100}%` }} />
        <span className="seg late" style={{ width: `${late * 100}%` }} />
        <span className="seg missed" style={{ width: `${other * 100}%` }} />
        <span className="otp-stop-target" style={{ left: `${targetPct}%` }} />
      </div>
      <div className={`otp-stop-value ${bar.belowTarget ? "below" : ""}`} aria-hidden="true">
        {bar.officialPct === null ? "—" : percentText(bar.officialPct)}
        {bar.approximate ? <span className="otp-stop-approx" title="Early/late split apportioned after weather days">*</span> : null}
      </div>
    </li>
  );
}

export function OtpStopChart({
  routeId,
  routeLabel,
  serviceMonth,
  measurement,
  onClose,
}: {
  routeId: number;
  routeLabel: string;
  serviceMonth: string;
  /** The month's measurement; a new one (after an approval) re-reads the stops. */
  measurement: OtpMonthMeasurement | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<OtpRouteStops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getOtpRouteStops(routeId, serviceMonth)
      .then((stops) => !cancelled && setData(stops))
      .catch((err) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof ApiError ? `Could not load timepoints: ${err.message}` : "Could not reach the OTP compliance service.");
      });
    return () => {
      cancelled = true;
    };
  }, [routeId, serviceMonth, measurement]);

  useEffect(() => setShowAll(false), [routeId]);

  const loaded = data && data.route_id === routeId ? data : null;
  const targetPct = Math.round((loaded?.target ?? measurement?.target ?? 0.85) * 1000) / 10;
  const routeMeasured = (loaded?.route?.route_category ?? "FixedRoute") === "FixedRoute";
  const bars = loaded ? stopBars(loaded.stops, loaded.target, routeMeasured) : [];
  const shown = showAll ? bars : bars.slice(0, FIRST_SHOWN);
  const anyApprox = bars.some((bar) => bar.approximate);
  const routeShare = loaded?.route?.assessable.pct ?? null;
  const routePct = routeShare === null ? null : Math.round(routeShare * 1000) / 10;

  return (
    <section className="subcard otp-stop-panel" aria-labelledby="otp-stop-heading">
      <div className="otp-stop-head">
        <h3 id="otp-stop-heading">
          <span className="route-chip">RT {routeLabel}</span>
          OTP by timepoint
          {routePct !== null ? <span className="muted"> · route {percentText(routePct)} official</span> : null}
        </h3>
        <button type="button" className="btn-sm" onClick={onClose}>Close</button>
      </div>
      <div className="otp-stop-legend" aria-hidden="true">
        <span><i className="seg ontime" />On time</span>
        <span><i className="seg early" />Early</span>
        <span><i className="seg late" />Late</span>
        <span><i className="seg missed" />Missed / other</span>
        <span><i className="otp-stop-target-key" />Target {targetPct}%</span>
      </div>

      {error ? <p className="error-text">{error}</p>
        : !loaded ? <p className="muted">Loading timepoints…</p>
          : bars.length === 0 ? <p className="muted">The OTP Monthly feed has no timepoints for this route this month.</p>
            : (
              <>
                <ol className="otp-stop-list" aria-label={`Route ${routeLabel} timepoints, lowest on-time performance first`}>
                  {shown.map((bar) => <Bar key={bar.key} bar={bar} targetPct={targetPct} />)}
                </ol>
                <p className="otp-stop-foot muted">
                  Avail measures OTP at timepoints, so these are the route's timepoints, not every stop. Worst first, not in route order: the monthly feed carries no stop sequence or direction.
                  {anyApprox ? " * After a weather day the early/late split is apportioned; on-time is exact." : ""}
                  {bars.length > FIRST_SHOWN ? (
                    <> <button type="button" className="btn-sm" onClick={() => setShowAll((v) => !v)}>
                      {showAll ? `Show worst ${FIRST_SHOWN}` : `Show all ${bars.length} timepoints`}
                    </button></>
                  ) : null}
                </p>
              </>
            )}
    </section>
  );
}
