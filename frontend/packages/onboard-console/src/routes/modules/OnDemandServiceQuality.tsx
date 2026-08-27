import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type OnDemandRiskRecord,
  type OnDemandRiskDiagnostics,
  type OnDemandServiceStandardPolicy,
  type PrepareSuggestedAlertInput,
} from "@mvta/shared";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";
import { api } from "../../config.js";
import { KpiTrustSummary } from "./KpiTrustSummary.js";
import {
  ON_DEMAND_RISKS,
  type OnDemandRisk,
  type RiskConfidence,
  type RiskTrend,
  type RiskWorkflow,
} from "./serviceRisk.data.js";
import "./serviceRisk.css";

type DataMode = "loading" | "live" | "preview" | "authentication_required";

function monitoringLabel(mode: DataMode, diagnostics: OnDemandRiskDiagnostics | null): string {
  if (mode === "loading") return "Loading";
  if (mode === "preview") return "Preview data";
  if (mode === "authentication_required") return "Authentication required";
  if (diagnostics?.state === "current") return "Live data";
  if (diagnostics?.state === "not_connected") return "Not connected";
  if (diagnostics?.state === "degraded") return "Degraded";
  return "No active service";
}

function monitoringMessage(mode: DataMode, diagnostics: OnDemandRiskDiagnostics | null, previewMessage: string | null): string {
  if (mode === "loading") return "Checking the protected on-demand monitor.";
  if (mode === "preview") return previewMessage ?? "Preview scenarios are shown locally; no workflow changes will be saved.";
  if (mode === "authentication_required") return "Sign in again to access protected on-demand monitoring.";
  if (diagnostics?.state === "not_connected") return "On-Demand monitoring is not connected.";
  if (diagnostics?.state === "degraded") {
    const last = diagnostics.last_authoritative_reconciliation_at
      ? new Date(diagnostics.last_authoritative_reconciliation_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "Unknown";
    return `On-Demand reconciliation is overdue (last authoritative reconciliation: ${last}); last-known records are read-only.`;
  }
  if (diagnostics?.state === "no_active_service") return "The latest authoritative reconciliation found no active on-demand service.";
  return "Current wait-risk records are provided by the vendor-neutral on-demand monitoring contract.";
}

function confidenceClass(confidence: RiskConfidence | "Unknown"): string {
  if (confidence === "High") return "pill-success";
  if (confidence === "Medium") return "pill-warning";
  return "pill-muted";
}

function trendClass(trend: RiskTrend): string {
  if (trend === "Worsening") return "risk-trend worsening";
  if (trend === "Recovering") return "risk-trend recovering";
  return "risk-trend";
}

function waitState(risk: OnDemandRisk, serviceStandard: number): { label: string; className: string } {
  if (risk.zoneResolution === "legacy_unknown") return { label: "Monitoring incomplete", className: "pill-muted" };
  if (risk.zoneResolution && risk.zoneResolution !== "assigned") return { label: "Unzoned", className: "pill-muted" };
  if (risk.currentWaitMinutes >= serviceStandard + 15 || risk.predictedWaitMinutes >= serviceStandard + 15) return { label: "Critical", className: "pill-danger" };
  if (risk.currentWaitMinutes > serviceStandard) return { label: "Standard exceeded", className: "pill-danger" };
  if (risk.predictedWaitMinutes > serviceStandard) return { label: "Projected risk", className: "pill-warning" };
  if (risk.predictedWaitMinutes > 20) return { label: "Watch", className: "pill-warning" };
  if (risk.currentWaitMinutes > 0) return { label: "Overdue", className: "pill-warning" };
  return { label: "Watch", className: "pill-accent" };
}

function titleCase<T extends string>(value: T): Capitalize<T> {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as Capitalize<T>;
}

function fromOnDemandRecord(record: OnDemandRiskRecord): OnDemandRisk {
  return {
    id: `live-${record.trip_id}`,
    tripNumber: record.external_trip_id ?? record.trip_id,
    zone: record.zone_id,
    currentWaitMinutes: record.current_wait_minutes,
    predictedWaitMinutes:
      record.predicted_wait_minutes ?? record.current_wait_minutes,
    predictedPickup: record.predicted_pickup_at
      ? new Date(record.predicted_pickup_at).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : "Unknown",
    vehicle: record.assigned_vehicle_id,
    stopsAhead: record.stops_ahead,
    confidence: record.prediction_confidence
      ? titleCase(record.prediction_confidence)
      : "Unknown",
    trend: titleCase(record.trend),
    accessibleVehicleRequired: record.accessible_vehicle_required,
    availableVehicles: record.eligible_vehicles_in_zone,
    nearestEligibleVehicle: record.nearest_vehicle_context,
    reasons: record.prediction_reasons.length
      ? record.prediction_reasons
      : ["Prediction evidence is not available for this record."],
    sourceTripId: record.trip_id,
    suggestedAlertId: record.suggested_alert_id,
    interventionStatus: record.intervention_status,
    serviceStandardMinutes: record.service_standard_minutes,
    zoneResolution: record.zone_resolution,
  };
}

function onDemandDraft(risk: OnDemandRisk, serviceStandard: number): PrepareSuggestedAlertInput {
  return {
    source: "zona",
    external_id: `wait:${risk.sourceTripId ?? risk.tripNumber}`.slice(0, 100),
    draft_text:
      `MVTA Connect customers in Zone ${risk.zone}: Pickup for this trip is predicted ` +
      `after approximately ${risk.predictedWaitMinutes} minutes, above the ${serviceStandard}-minute ` +
      "service standard. Please check for updated pickup information.",
    category: "demand_response_delay",
    severity: risk.predictedWaitMinutes >= serviceStandard + 15 ? "major" : "minor",
    zones_affected: [risk.zone],
    detail: {
      detection_type: "on_demand_wait_risk",
      trip_id: risk.sourceTripId ?? risk.tripNumber,
      external_trip_id: risk.tripNumber,
      zone_id: risk.zone,
      current_wait_minutes: risk.currentWaitMinutes,
      predicted_wait_minutes: risk.predictedWaitMinutes,
      service_standard_minutes: serviceStandard,
      assigned_vehicle_id: risk.vehicle,
      confidence: risk.confidence.toLowerCase(),
      prepared_from: "occ_on_demand_quality",
    },
  };
}

export function OnDemandServiceQuality() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const [selectedId, setSelectedId] = useState(ON_DEMAND_RISKS[0].id);
  const [workflow, setWorkflow] = useState<Record<string, RiskWorkflow>>({});
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const [trainingMode, setTrainingMode] = useState(false);
  const [liveRisks, setLiveRisks] = useState<OnDemandRisk[]>([]);
  const [diagnostics, setDiagnostics] = useState<OnDemandRiskDiagnostics | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [previewDrafts, setPreviewDrafts] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [allZonesStandard, setAllZonesStandard] = useState(25);
  const [policy, setPolicy] = useState<OnDemandServiceStandardPolicy | null>(null);
  const isPreview = trainingMode || dataMode === "preview";
  const risks = isPreview ? ON_DEMAND_RISKS : liveRisks;
  const standardFor = (risk: OnDemandRisk) => {
    if (risk.serviceStandardMinutes !== undefined) return risk.serviceStandardMinutes;
    const override = policy?.zones.find((item) => item.external_location_id === risk.zone && item.override_active);
    return override?.minutes ?? allZonesStandard;
  };
  const selected = useMemo(
    () =>
      risks.find((risk) => risk.id === selectedId) ??
      risks[0] ??
      ON_DEMAND_RISKS[0],
    [risks, selectedId],
  );

  useEffect(() => {
    let alive = true;
    const load = () => api
      .getOnDemandRisks()
      .then(({ risks: records, diagnostics: nextDiagnostics }) => {
        if (!alive) return;
        const mapped = records.map(fromOnDemandRecord);
        setLiveRisks(mapped);
        setDiagnostics(nextDiagnostics);
        setDataMode("live");
        setLiveMessage(null);
        if (mapped.length > 0) setSelectedId(mapped[0].id);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setDataMode("authentication_required");
          setDiagnostics(null);
          setLiveMessage(null);
          return;
        }
        setDataMode("preview");
        setDiagnostics(null);
        setLiveMessage(
          "Preview mode — local mock sign-in cannot access operational wait-time data. " +
          "No alerts or workflow changes will be saved.",
        );
      });
    void load();
    const refreshId = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(refreshId);
    };
  }, []);

  useEffect(() => {
    api.getOnDemandServiceStandards()
      .then((result) => {
        setPolicy(result);
        setAllZonesStandard(result.default_minutes);
      })
      .catch(() => undefined);
  }, []);

  async function prepareUpdate(risk: OnDemandRisk) {
    setPrepareError(null);
    const draft = onDemandDraft(risk, standardFor(risk));
    if (isPreview) {
      setPreviewDrafts((current) => ({ ...current, [risk.id]: draft.draft_text }));
      setWorkflow((current) => ({ ...current, [risk.id]: "Alert prepared" }));
      return;
    }
    if (diagnostics?.state !== "current") return;
    if (risk.suggestedAlertId) {
      navigate(`/suggested?focus=${encodeURIComponent(risk.suggestedAlertId)}`);
      return;
    }
    setPreparing(true);
    try {
      const { streams } = await api.getKpiTrust();
      if (streams.on_demand?.state !== "current") {
        setPrepareError("Suggested Alerts are unavailable while On-Demand KPI trust is not current.");
        return;
      }
      const result = await api.prepareSuggestedAlert(draft);
      navigate(`/suggested?focus=${encodeURIComponent(result.alert_id)}`);
    } catch (err) {
      setPrepareError(
        err instanceof ApiError
          ? err.message
          : "The customer update draft could not be prepared.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function resolveIntervention(risk: OnDemandRisk) {
    if (!risk.sourceTripId || risk.interventionStatus !== "open") return;
    setResolving(true);
    try {
      await api.resolveOnDemandIntervention(risk.sourceTripId);
      setLiveRisks((current) => current.map((item) => item.id === risk.id
        ? { ...item, interventionStatus: "resolved" }
        : item));
      setWorkflow((current) => ({ ...current, [risk.id]: "Monitoring" }));
    } catch (err) {
      setPrepareError(err instanceof ApiError ? err.message : "The intervention could not be resolved.");
    } finally {
      setResolving(false);
    }
  }

  const predictedPoor = risks.filter((risk) => risk.predictedWaitMinutes > standardFor(risk)).length;
  const currentlyPoor = risks.filter((risk) => risk.currentWaitMinutes > standardFor(risk)).length;
  const unassigned = risks.filter((risk) => risk.vehicle === null).length;
  const sortedWaits = [...risks].map((risk) => risk.predictedWaitMinutes).sort((a, b) => a - b);
  const median = sortedWaits.length
    ? sortedWaits[Math.floor((sortedWaits.length - 1) / 2)]
    : 0;

  return (
    <div className="risk-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">MVTA Connect prediction</span>
          <h2>On-Demand Service Quality</h2>
          <p>Customers predicted to wait more than their applicable service-quality standard.</p>
        </div>
        <div className="standard-chip">
          <span>All-zones default</span>
          <strong>{allZonesStandard} min</strong>
          <button className="btn-sm" onClick={() => setTrainingMode((current) => !current)}>
            {trainingMode ? "Return to monitoring" : "Training scenario"}
          </button>
        </div>
      </div>

      <KpiTrustSummary stream="on_demand" />

      <div className="concept-banner">
        <span className="concept-badge">{trainingMode ? "Training" : monitoringLabel(dataMode, diagnostics)}</span>
        <span>{trainingMode
          ? "Training scenario — local rehearsal only. No operational data or workflow changes will be saved."
          : monitoringMessage(dataMode, diagnostics, liveMessage)}</span>
      </div>

      <div className="risk-stat-grid" aria-label="On-demand service quality summary">
        <RiskStat value={predictedPoor} label="Predicted over standard" tone="warning" />
        <RiskStat value={currentlyPoor} label="Currently over standard" tone="danger" />
        <RiskStat value={unassigned} label="Unassigned at risk" tone="muted" />
        <RiskStat value={`${median} min`} label="Median predicted wait" tone="accent" />
      </div>

      {dataMode === "loading" && !trainingMode ? (
        <div className="risk-empty-state" role="status">
          <strong>Loading on-demand monitoring</strong>
          <span>Checking the protected monitor and its source health.</span>
        </div>
      ) : !trainingMode && dataMode === "live" && diagnostics?.state === "not_connected" ? (
        <div className="risk-empty-state">
          <strong>On-Demand monitoring is not connected</strong>
          <span>Connect and verify the approved source before relying on on-demand risk data.</span>
        </div>
      ) : !trainingMode && dataMode === "live" && diagnostics?.state === "no_active_service" ? (
        <div className="risk-empty-state">
          <strong>No active on-demand service</strong>
          <span>The latest authoritative reconciliation found no active requests.</span>
        </div>
      ) : !trainingMode && dataMode === "live" && diagnostics?.state === "degraded" && risks.length === 0 ? (
        <div className="risk-empty-state">
          <strong>On-Demand monitoring is degraded</strong>
          <span>There is no current risk claim until authoritative reconciliation recovers.</span>
        </div>
      ) : !trainingMode && dataMode === "authentication_required" ? (
        <div className="risk-empty-state">
          <strong>Authentication required</strong>
          <span>Sign in again before treating this workspace as live monitoring.</span>
        </div>
      ) : risks.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No on-demand wait risks</strong>
          <span>No active customer wait is currently inside the watch band or above its applicable standard.</span>
        </div>
      ) : (
      <div className="risk-workspace">
        <section className="risk-list-panel" aria-label="On-demand wait-time exceptions">
          <div className="risk-section-head">
            <div>
              <span className="risk-eyebrow">Immediate attention</span>
              <h3>Wait-time exceptions</h3>
            </div>
            <span className="risk-count">{risks.length} trips</span>
          </div>

          <div className="risk-list-head on-demand" aria-hidden="true">
            <span>Trip</span>
            <span>Wait</span>
            <span>Status</span>
          </div>

          {risks.map((risk) => {
            const active = risk.id === selected.id;
            const state = waitState(risk, standardFor(risk));
            return (
              <button
                className={`risk-list-row on-demand ${active ? "selected" : ""}`}
                key={risk.id}
                onClick={() => setSelectedId(risk.id)}
                aria-pressed={active}
              >
                <span className="risk-service">
                  <strong>Trip {risk.tripNumber} · Zone {risk.zone}</strong>
                  <small>Vehicle {risk.vehicle ?? "unassigned"} · {workflow[risk.id] ?? "New"}</small>
                </span>
                <span className="risk-departure">
                  <strong>{risk.currentWaitMinutes} min now</strong>
                  <small>{risk.predictedWaitMinutes} min predicted</small>
                </span>
                <span className="risk-threshold">
                  <span className={`pill-sm ${state.className}`}>{state.label}</span>
                  <small className={trendClass(risk.trend)}>{risk.trend}</small>
                </span>
              </button>
            );
          })}
        </section>

        <OnDemandDetail
          risk={selected}
          workflow={workflow[selected.id] ?? "New"}
          isPreview={isPreview}
          actionsDisabled={!isPreview && dataMode === "live" && diagnostics?.state !== "current"}
          previewDraft={previewDrafts[selected.id] ?? null}
          preparing={preparing}
          prepareError={prepareError}
          serviceStandard={standardFor(selected)}
          onPrepare={() => void prepareUpdate(selected)}
          onWorkflow={(state) => setWorkflow((current) => ({ ...current, [selected.id]: state }))}
          canResolve={roles.some((role) => role === "OCC.Publisher" || role === "OCC.Admin")}
          resolving={resolving}
          onResolve={() => void resolveIntervention(selected)}
        />
      </div>
      )}
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

function OnDemandDetail({
  risk,
  workflow,
  isPreview,
  actionsDisabled,
  previewDraft,
  preparing,
  prepareError,
  serviceStandard,
  onPrepare,
  onWorkflow,
  canResolve,
  resolving,
  onResolve,
}: {
  risk: OnDemandRisk;
  workflow: RiskWorkflow;
  isPreview: boolean;
  actionsDisabled: boolean;
  previewDraft: string | null;
  preparing: boolean;
  prepareError: string | null;
  serviceStandard: number;
  onPrepare: () => void;
  onWorkflow: (workflow: RiskWorkflow) => void;
  canResolve: boolean;
  resolving: boolean;
  onResolve: () => void;
}) {
  const state = waitState(risk, serviceStandard);
  const thresholdDelta = risk.predictedWaitMinutes - serviceStandard;

  return (
    <aside className="risk-detail" aria-label={`Connect trip ${risk.tripNumber} wait-time detail`}>
      <div className="risk-detail-head">
        <div>
          <span className="risk-eyebrow">Selected exception</span>
          <h3>Connect Trip {risk.tripNumber}</h3>
          <p>Zone {risk.zone} · Vehicle {risk.vehicle ?? "unassigned"}</p>
        </div>
        <span className={`pill-sm ${confidenceClass(risk.confidence)}`}>{risk.confidence} confidence</span>
      </div>

      <div className="risk-hero-metric on-demand">
        <span>Predicted total customer wait</span>
        <strong>{risk.predictedWaitMinutes} min</strong>
        <small className={thresholdDelta > 0 ? "over-standard" : ""}>
          {thresholdDelta > 0 ? `${thresholdDelta} minutes above the service standard` : `${Math.abs(thresholdDelta)} minutes below the standard`}
        </small>
      </div>

      <div className="wait-progress" aria-label={`${risk.currentWaitMinutes} minutes elapsed of ${serviceStandard}-minute standard`}>
        <div className="wait-progress-meta">
          <span>{risk.currentWaitMinutes} min elapsed</span>
          <span>{serviceStandard} min standard</span>
        </div>
        <div className="wait-track">
          <span style={{ width: `${Math.min((risk.currentWaitMinutes / serviceStandard) * 100, 100)}%` }} />
          <i />
        </div>
      </div>

      <dl className="risk-facts">
        <div><dt>Predicted pickup</dt><dd>{risk.predictedPickup}</dd></div>
        <div><dt>Threshold status</dt><dd><span className={`pill-sm ${state.className}`}>{state.label}</span></dd></div>
        <div><dt>Assigned vehicle</dt><dd>{risk.vehicle ?? "Unassigned"}</dd></div>
        <div><dt>Stops ahead</dt><dd>{risk.stopsAhead ?? "—"}</dd></div>
        <div><dt>Trend</dt><dd className={trendClass(risk.trend)}>{risk.trend}</dd></div>
        <div><dt>Workflow</dt><dd>{workflow}</dd></div>
      </dl>

      <div className="assignment-card">
        <span>Assignment context</span>
        <strong>{risk.nearestEligibleVehicle ?? "Unknown"}</strong>
        <small>
          {risk.availableVehicles ?? "Unknown"} eligible vehicle{risk.availableVehicles === 1 ? "" : "s"} available in zone
          {risk.accessibleVehicleRequired ? " · Accessible vehicle required" : ""}
        </small>
      </div>

      <div className="risk-detail-section">
        <h4>Why this was flagged</h4>
        <ul className="evidence-list">
          {risk.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </div>

      {previewDraft ? (
        <div className="risk-draft-preview" role="status">
          <span>Customer update preview — not saved</span>
          <p>{previewDraft}</p>
        </div>
      ) : null}
      {prepareError ? <p className="risk-action-error">{prepareError}</p> : null}

      <div className="risk-actions">
        <button className="btn-primary" disabled={preparing || actionsDisabled} onClick={onPrepare}>
          {preparing
            ? "Preparing…"
            : actionsDisabled
              ? "Actions unavailable"
            : isPreview
              ? "Preview Suggested Alert"
              : risk.suggestedAlertId
                ? "Review Suggested Alert"
                : "Prepare Suggested Alert"}
        </button>
        <Link
          className="btn-sm"
          to={`/occ?source=Service%20Risk&source_id=${encodeURIComponent(risk.id)}&q=wait`}
        >
          Find Procedure
        </Link>
        <button className="btn-sm" disabled={actionsDisabled} onClick={() => onWorkflow("Acknowledged")}>Acknowledge</button>
        <button className="btn-sm" disabled={actionsDisabled} onClick={() => onWorkflow("Monitoring")}>Monitor</button>
        {risk.interventionStatus === "open" && canResolve ? (
          <button className="btn-sm" disabled={actionsDisabled || resolving} onClick={onResolve}>
            {resolving ? "Resolving…" : "Resolve intervention"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
