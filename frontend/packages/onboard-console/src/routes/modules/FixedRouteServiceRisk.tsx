import { useEffect, useMemo, useState } from "react";
import { type TripDelay } from "@mvta/shared";
import { api } from "../../config.js";
import { LiveDelays } from "./LiveDelays.js";
import {
  FIXED_ROUTE_RISKS,
  type FixedRouteRisk,
  type RiskConfidence,
  type RiskTrend,
  type RiskWorkflow,
} from "./serviceRisk.data.js";
import "./serviceRisk.css";

type View = "exceptions" | "telemetry";

function titleCase<T extends string>(value: T): Capitalize<T> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<T>;
}

function timeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fromTripDelay(delay: TripDelay): FixedRouteRisk {
  const currentMinutes = Math.round(delay.delay_seconds / 60);
  const predictedSeconds =
    delay.predicted_max_departure_delay_seconds ?? delay.delay_seconds;
  const predictedMinutes = Math.round(predictedSeconds / 60);
  const thresholdAt = delay.first_threshold_departure_at
    ? new Date(delay.first_threshold_departure_at)
    : null;
  const thresholdIn =
    thresholdAt && !Number.isNaN(thresholdAt.getTime())
      ? Math.max(0, Math.round((thresholdAt.getTime() - Date.now()) / 60_000))
      : null;
  const trend: RiskTrend =
    predictedSeconds > delay.delay_seconds + 120
      ? "Worsening"
      : predictedSeconds < delay.delay_seconds - 120
        ? "Recovering"
        : "Stable";
  const updatedAt = new Date(delay.prediction_updated_at ?? delay.last_polled_at);

  return {
    id: `live-${delay.service_date ?? "current"}-${delay.trip_id}`,
    tripId: delay.trip_id,
    route: delay.route_id,
    direction: delay.direction_label ?? "—",
    vehicle: delay.vehicle_id,
    currentDelayMinutes: currentMinutes,
    predictedMaxMinutes: predictedMinutes,
    firstAffectedDeparture:
      delay.first_threshold_stop_name ??
      (delay.first_threshold_stop_id
        ? `Stop ${delay.first_threshold_stop_id}`
        : "No future threshold crossing"),
    firstAffectedTime: timeLabel(delay.first_threshold_departure_at),
    thresholdInMinutes: thresholdIn,
    trend,
    confidence: delay.prediction_confidence
      ? titleCase(delay.prediction_confidence)
      : "Low",
    location: delay.latitude !== null && delay.longitude !== null
      ? `${delay.latitude.toFixed(4)}, ${delay.longitude.toFixed(4)}`
      : "Vehicle position unavailable",
    tripProgress: delay.next_stop_name
      ? `Next departure: ${delay.next_stop_name}`
      : "Current trip progress",
    updatedSecondsAgo: Number.isNaN(updatedAt.getTime())
      ? 0
      : Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 1000)),
    reasons: delay.prediction_reasons.length
      ? delay.prediction_reasons
      : ["Prediction confidence details are not available for this observation."],
    downstreamTrip: null,
    downstreamDelayMinutes: null,
    timeline: delay.departure_predictions.map((prediction) => {
      const predicted = prediction.predicted_departure_at
        ? new Date(prediction.predicted_departure_at)
        : null;
      const scheduled =
        predicted && !Number.isNaN(predicted.getTime())
          ? new Date(predicted.getTime() - prediction.departure_delay_seconds * 1000)
          : null;
      const stopName =
        prediction.stop_id === delay.first_threshold_stop_id &&
        delay.first_threshold_stop_name
          ? delay.first_threshold_stop_name
          : prediction.stop_id
            ? `Stop ${prediction.stop_id}`
            : `Stop sequence ${prediction.stop_sequence}`;
      return {
        stop: stopName,
        scheduled: scheduled
          ? scheduled.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "Unknown",
        predicted: predicted
          ? predicted.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "Unknown",
        varianceMinutes: Math.round(prediction.departure_delay_seconds / 60),
        threshold: prediction.stop_id === delay.first_threshold_stop_id,
      };
    }),
  };
}

function confidenceClass(confidence: RiskConfidence): string {
  if (confidence === "High") return "pill-success";
  if (confidence === "Medium") return "pill-warning";
  return "pill-muted";
}

function trendClass(trend: RiskTrend): string {
  if (trend === "Worsening") return "risk-trend worsening";
  if (trend === "Recovering") return "risk-trend recovering";
  return "risk-trend";
}

function departureDelay(value: number | null, predicted = false) {
  if (value === null) return <span className="risk-unknown">Unknown</span>;
  const cls = value > 15 ? "pill-danger" : value >= 10 ? "pill-warning" : "pill-muted";
  return (
    <span className={`pill-sm ${cls}`}>
      {predicted ? "Predicted " : ""}+{value} min
    </span>
  );
}

export function FixedRouteServiceRisk() {
  const [view, setView] = useState<View>("exceptions");
  const [selectedId, setSelectedId] = useState(FIXED_ROUTE_RISKS[0].id);
  const [workflow, setWorkflow] = useState<Record<string, RiskWorkflow>>({});
  const [liveRisks, setLiveRisks] = useState<FixedRouteRisk[] | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const risks = liveRisks ?? FIXED_ROUTE_RISKS;
  const selected = useMemo(
    () =>
      risks.find((risk) => risk.id === selectedId) ??
      risks[0] ??
      FIXED_ROUTE_RISKS[0],
    [risks, selectedId],
  );

  useEffect(() => {
    api
      .getTripDelays()
      .then(({ delays }) => {
        const mapped = delays
          .map(fromTripDelay)
          .filter(
            (risk) =>
              risk.predictedMaxMinutes === null ||
              risk.predictedMaxMinutes > 15 ||
              risk.currentDelayMinutes === null ||
              risk.currentDelayMinutes > 15,
          );
        setLiveRisks(mapped);
        setLiveMessage(null);
        if (mapped.length > 0) setSelectedId(mapped[0].id);
      })
      .catch(() => {
        setLiveRisks(null);
        setLiveMessage("Authenticated prediction data is unavailable, so review scenarios are shown.");
      });
  }, []);

  if (view === "telemetry") {
    return (
      <div className="risk-module">
        <RiskModuleHeader
          title="Fixed Route Service Risk"
          description="Departure-risk exceptions and supporting realtime telemetry."
          view={view}
          onView={setView}
        />
        <LiveDelays />
      </div>
    );
  }

  const predicted = risks.filter((risk) => (risk.predictedMaxMinutes ?? 0) > 15).length;
  const missing = risks.filter((risk) => risk.predictedMaxMinutes === null).length;
  const worsening = risks.filter((risk) => risk.trend === "Worsening").length;
  const routesAffected = new Set(risks.map((risk) => risk.route)).size;

  return (
    <div className="risk-module">
      <RiskModuleHeader
        title="Fixed Route Service Risk"
        description="Trips predicted to depart more than 15 minutes late, ordered by time to intervention."
        view={view}
        onView={setView}
      />

      <div className="concept-banner">
        <span className="concept-badge">{liveRisks === null ? "Preview data" : "Live data"}</span>
        {liveRisks === null
          ? liveMessage ?? "Loading authenticated departure predictions; review scenarios are shown meanwhile."
          : "Future departure predictions are calculated from the current GTFS-Realtime TripUpdate feed."}
      </div>

      <div className="risk-stat-grid" aria-label="Fixed route risk summary">
        <RiskStat value={predicted} label="Predicted over 15 min" tone="danger" />
        <RiskStat value={worsening} label="Worsening trips" tone="warning" />
        <RiskStat value={missing} label="Missing predictions" tone="muted" />
        <RiskStat value={routesAffected} label="Routes affected" tone="accent" />
      </div>

      {risks.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No fixed-route departure risks</strong>
          <span>No monitored trip is currently predicted to depart more than 15 minutes late.</span>
        </div>
      ) : (
      <div className="risk-workspace">
        <section className="risk-list-panel" aria-label="Fixed route exceptions">
          <div className="risk-section-head">
            <div>
              <span className="risk-eyebrow">Immediate attention</span>
              <h3>Departure-risk exceptions</h3>
            </div>
            <span className="risk-count">{risks.length} trips</span>
          </div>

          <div className="risk-list-head" aria-hidden="true">
            <span>Service</span>
            <span>Departure risk</span>
            <span>Threshold</span>
          </div>

          {risks.map((risk) => {
            const active = risk.id === selected.id;
            const state = workflow[risk.id] ?? "New";
            return (
              <button
                className={`risk-list-row ${active ? "selected" : ""}`}
                key={risk.id}
                onClick={() => setSelectedId(risk.id)}
                aria-pressed={active}
              >
                <span className="risk-service">
                  <strong>Route {risk.route} {risk.direction}</strong>
                  <small>Vehicle {risk.vehicle ?? "unassigned"} · {state}</small>
                </span>
                <span className="risk-departure">
                  {departureDelay(risk.predictedMaxMinutes, true)}
                  <small>{risk.firstAffectedDeparture}</small>
                </span>
                <span className="risk-threshold">
                  <strong>{risk.thresholdInMinutes === null ? "Data gap" : `${risk.thresholdInMinutes} min`}</strong>
                  <small className={trendClass(risk.trend)}>{risk.trend}</small>
                </span>
              </button>
            );
          })}
        </section>

        <DepartureRiskDetail
          risk={selected}
          workflow={workflow[selected.id] ?? "New"}
          onWorkflow={(state) => setWorkflow((current) => ({ ...current, [selected.id]: state }))}
        />
      </div>
      )}
    </div>
  );
}

function RiskModuleHeader({
  title,
  description,
  view,
  onView,
}: {
  title: string;
  description: string;
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div className="risk-module-head">
      <div>
        <span className="risk-eyebrow">Control center prediction</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="risk-view-toggle" aria-label="Fixed route view">
        <button className={view === "exceptions" ? "active" : ""} onClick={() => onView("exceptions")}>
          Exceptions
        </button>
        <button className={view === "telemetry" ? "active" : ""} onClick={() => onView("telemetry")}>
          Current telemetry
        </button>
      </div>
    </div>
  );
}

function RiskStat({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone: "danger" | "warning" | "muted" | "accent";
}) {
  return (
    <div className={`risk-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DepartureRiskDetail({
  risk,
  workflow,
  onWorkflow,
}: {
  risk: FixedRouteRisk;
  workflow: RiskWorkflow;
  onWorkflow: (workflow: RiskWorkflow) => void;
}) {
  return (
    <aside className="risk-detail" aria-label={`Route ${risk.route} departure-risk detail`}>
      <div className="risk-detail-head">
        <div>
          <span className="risk-eyebrow">Selected exception</span>
          <h3>Route {risk.route} {risk.direction}</h3>
          <p>Trip {risk.tripId} · Vehicle {risk.vehicle ?? "unassigned"}</p>
        </div>
        <span className={`pill-sm ${confidenceClass(risk.confidence)}`}>{risk.confidence} confidence</span>
      </div>

      <div className="risk-hero-metric">
        <span>Predicted maximum departure delay</span>
        <strong>{risk.predictedMaxMinutes === null ? "Unknown" : `+${risk.predictedMaxMinutes} min`}</strong>
        <small>
          {risk.thresholdInMinutes === null
            ? "Realtime prediction unavailable"
            : `First threshold crossing in ${risk.thresholdInMinutes} minutes`}
        </small>
      </div>

      <dl className="risk-facts">
        <div><dt>Current departure delay</dt><dd>{risk.currentDelayMinutes === null ? "Unknown" : `+${risk.currentDelayMinutes} min`}</dd></div>
        <div><dt>First affected departure</dt><dd>{risk.firstAffectedDeparture}</dd></div>
        <div><dt>Scheduled departure</dt><dd>{risk.firstAffectedTime}</dd></div>
        <div><dt>Trend</dt><dd className={trendClass(risk.trend)}>{risk.trend}</dd></div>
        <div><dt>Last updated</dt><dd>{risk.updatedSecondsAgo} sec ago</dd></div>
        <div><dt>Workflow</dt><dd>{workflow}</dd></div>
      </dl>

      <div className="risk-detail-section">
        <h4>Why this was flagged</h4>
        <ul className="evidence-list">
          {risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>

      <div className="risk-detail-section">
        <div className="risk-section-title-row">
          <h4>Departure timeline</h4>
          <span>{risk.tripProgress}</span>
        </div>
        <div className="departure-timeline">
          {risk.timeline.map((stop) => (
            <div className={`timeline-stop ${stop.threshold ? "threshold" : ""}`} key={stop.stop}>
              <span className="timeline-dot" />
              <div>
                <strong>{stop.stop}</strong>
                <small>{stop.scheduled} scheduled · {stop.predicted} predicted</small>
              </div>
              <span className={stop.predicted === "Unknown" ? "risk-unknown" : stop.varianceMinutes > 15 ? "timeline-late" : ""}>
                {stop.predicted === "Unknown" ? "Unknown" : `+${stop.varianceMinutes} min`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {risk.downstreamTrip ? (
        <div className="downstream-card">
          <span>Downstream block impact</span>
          <strong>{risk.downstreamTrip}</strong>
          <small>
            {risk.downstreamDelayMinutes === null
              ? "Starting-delay prediction unavailable"
              : `Predicted to start +${risk.downstreamDelayMinutes} minutes`}
          </small>
        </div>
      ) : null}

      <div className="risk-actions">
        <button className="btn-primary" onClick={() => onWorkflow("Alert prepared")}>Prepare alert</button>
        <button className="btn-sm" onClick={() => onWorkflow("Acknowledged")}>Acknowledge</button>
        <button className="btn-sm" onClick={() => onWorkflow("Monitoring")}>Monitor</button>
      </div>
    </aside>
  );
}
