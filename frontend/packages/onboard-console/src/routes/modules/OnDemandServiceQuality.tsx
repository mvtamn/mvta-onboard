import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type OnDemandRiskRecord,
  type OnDemandServiceStandardAudit,
  type OnDemandServiceStandardPolicy,
  type PrepareSuggestedAlertInput,
} from "@mvta/shared";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.js";
import { api } from "../../config.js";
import {
  ON_DEMAND_RISKS,
  type OnDemandRisk,
  type RiskConfidence,
  type RiskTrend,
  type RiskWorkflow,
} from "./serviceRisk.data.js";
import "./serviceRisk.css";

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

function waitState(risk: OnDemandRisk, serviceStandard: number): { label: string; className: string } {
  if (risk.zoneResolution === "legacy_unknown") return { label: "Monitoring incomplete", className: "pill-muted" };
  if (risk.zoneResolution && risk.zoneResolution !== "assigned") return { label: "Unzoned", className: "pill-muted" };
  if (risk.currentWaitMinutes >= serviceStandard + 15 || risk.predictedWaitMinutes >= serviceStandard + 15) return { label: "Critical", className: "pill-danger" };
  if (risk.currentWaitMinutes > serviceStandard) return { label: "Standard exceeded", className: "pill-danger" };
  if (risk.currentWaitMinutes > 0) return { label: "Overdue", className: "pill-warning" };
  if (risk.predictedWaitMinutes > serviceStandard) return { label: "Projected risk", className: "pill-warning" };
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
      : "Low",
    trend: titleCase(record.trend),
    accessibleVehicleRequired: record.accessible_vehicle_required,
    availableVehicles: record.eligible_vehicles_in_zone ?? 0,
    nearestEligibleVehicle:
      record.nearest_vehicle_context ?? "Vehicle context unavailable",
    reasons: record.prediction_reasons.length
      ? record.prediction_reasons
      : ["Prediction evidence is not available for this record."],
    sourceTripId: record.trip_id,
    suggestedAlertId: record.suggested_alert_id,
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
  const canManageStandards = roles.includes("OCC.Admin");
  const [selectedId, setSelectedId] = useState(ON_DEMAND_RISKS[0].id);
  const [workflow, setWorkflow] = useState<Record<string, RiskWorkflow>>({});
  const [liveRisks, setLiveRisks] = useState<OnDemandRisk[] | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [previewDrafts, setPreviewDrafts] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [allZonesStandard, setAllZonesStandard] = useState(25);
  const [policy, setPolicy] = useState<OnDemandServiceStandardPolicy | null>(null);
  const [policyAudit, setPolicyAudit] = useState<OnDemandServiceStandardAudit[]>([]);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [overrideZoneId, setOverrideZoneId] = useState("");
  const [overrideMinutes, setOverrideMinutes] = useState(25);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideEffectiveAt, setOverrideEffectiveAt] = useState("");
  const [overrideExpiresAt, setOverrideExpiresAt] = useState("");
  const risks = liveRisks ?? ON_DEMAND_RISKS;
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
    api
      .getOnDemandRisks()
      .then(({ risks: records }) => {
        const mapped = records.map(fromOnDemandRecord);
        setLiveRisks(mapped);
        setLiveMessage(null);
        if (mapped.length > 0) setSelectedId(mapped[0].id);
      })
      .catch(() => {
        setLiveRisks(null);
        setLiveMessage(
          "Preview mode — local mock sign-in cannot access operational wait-time data. " +
          "No alerts or workflow changes will be saved.",
        );
      });
  }, []);

  useEffect(() => {
    if (!canManageStandards) return;
    api.getOnDemandServiceStandardAudit().then((result) => setPolicyAudit(result.audit)).catch(() => undefined);
  }, [canManageStandards]);

  useEffect(() => {
    api.getOnDemandServiceStandards()
      .then((result) => {
        setPolicy(result);
        setAllZonesStandard(result.default_minutes);
        setOverrideZoneId(result.zones[0]?.zone_id ?? "");
      })
      .catch(() => setPolicyMessage("The saved service standard is unavailable; showing the 25-minute default."));
  }, []);

  async function refreshPolicy() {
    const [result, audit] = await Promise.all([
      api.getOnDemandServiceStandards(),
      canManageStandards ? api.getOnDemandServiceStandardAudit() : Promise.resolve({ audit: [] }),
    ]);
    setPolicy(result);
    setPolicyAudit(audit.audit);
    setAllZonesStandard(result.default_minutes);
    setPolicyMessage(null);
  }

  async function saveDefault() {
    setSavingPolicy(true);
    try {
      await api.updateOnDemandServiceStandard(allZonesStandard);
      await refreshPolicy();
    } catch {
      setPolicyMessage("The all-zones standard could not be saved.");
    } finally { setSavingPolicy(false); }
  }

  async function saveOverride() {
    if (!overrideZoneId) return;
    setSavingPolicy(true);
    try {
      await api.updateOnDemandZoneServiceStandard(overrideZoneId, {
        minutes: overrideMinutes,
        reason: overrideReason,
        effective_at: new Date(overrideEffectiveAt).toISOString(),
        expires_at: new Date(overrideExpiresAt).toISOString(),
      });
      await refreshPolicy();
      setOverrideReason("");
    } catch {
      setPolicyMessage("The Zone override could not be saved. Include a reason and a valid effective period.");
    } finally { setSavingPolicy(false); }
  }

  async function removeOverride(zoneId: string) {
    setSavingPolicy(true);
    try {
      await api.removeOnDemandZoneServiceStandard(zoneId);
      await refreshPolicy();
    } catch {
      setPolicyMessage("The Zone override could not be removed.");
    } finally { setSavingPolicy(false); }
  }

  async function prepareUpdate(risk: OnDemandRisk) {
    setPrepareError(null);
    const draft = onDemandDraft(risk, standardFor(risk));
    if (liveRisks === null) {
      setPreviewDrafts((current) => ({ ...current, [risk.id]: draft.draft_text }));
      setWorkflow((current) => ({ ...current, [risk.id]: "Alert prepared" }));
      return;
    }
    if (risk.suggestedAlertId) {
      navigate(`/suggested?focus=${encodeURIComponent(risk.suggestedAlertId)}`);
      return;
    }
    setPreparing(true);
    try {
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
        </div>
      </div>

      <section className="service-standard-controls" aria-label="Service standard controls">
        <div className="service-standard-head">
          <div>
            <span className="risk-eyebrow">Current review threshold</span>
            <h3>Service standard</h3>
          </div>
          <small>{policy ? "Saved policy" : "Default shown"}</small>
        </div>
        <label className="service-standard-default" htmlFor="all-zones-standard">
          <span>All-zones default</span>
          <strong>{allZonesStandard} min</strong>
        </label>
        <input
          id="all-zones-standard"
          aria-label="All-zones service standard"
          type="range"
          min={10}
          max={60}
          step={1}
          value={allZonesStandard}
          onChange={(event) => setAllZonesStandard(Number(event.target.value))}
          disabled={!canManageStandards}
        />
        {canManageStandards && <button className="btn-sm" disabled={savingPolicy} onClick={() => void saveDefault()}>Save all-zones default</button>}
        <div className="zone-standard-list">
          {(policy?.zones ?? []).map((zone) => {
            const active = zone.override_active;
            return (
              <div className="zone-standard-row" key={zone.zone_id}>
                <label>
                  <span>{zone.name}</span>
                  <small>{active ? `${zone.minutes} min until ${new Date(zone.expires_at!).toLocaleString()}` : "Uses all-zones default"}</small>
                </label>
                <strong>{active ? `${zone.minutes} min` : `${allZonesStandard} min`}</strong>
                {canManageStandards && zone.minutes !== null && <button className="btn-sm" disabled={savingPolicy} onClick={() => void removeOverride(zone.zone_id)}>Use default</button>}
              </div>
            );
          })}
        </div>
        {canManageStandards && policy && (
          <div className="zone-standard-editor">
            <strong>Zone override</strong>
            <select aria-label="Operational Zone" value={overrideZoneId} onChange={(event) => setOverrideZoneId(event.target.value)}>
              {policy.zones.map((zone) => <option key={zone.zone_id} value={zone.zone_id}>{zone.name}</option>)}
            </select>
            <label>Minutes <input aria-label="Zone override minutes" type="number" min={10} max={60} value={overrideMinutes} onChange={(event) => setOverrideMinutes(Number(event.target.value))} /></label>
            <label>Reason <input aria-label="Zone override reason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label>
            <label>Effective <input aria-label="Zone override effective time" type="datetime-local" value={overrideEffectiveAt} onChange={(event) => setOverrideEffectiveAt(event.target.value)} /></label>
            <label>Expires <input aria-label="Zone override expiry time" type="datetime-local" value={overrideExpiresAt} onChange={(event) => setOverrideExpiresAt(event.target.value)} /></label>
            <button className="btn-sm" disabled={savingPolicy} onClick={() => void saveOverride()}>Save Zone override</button>
          </div>
        )}
        {policyMessage && <small className="service-standard-message">{policyMessage}</small>}
        {canManageStandards && policyAudit.length > 0 && (
          <div className="service-standard-audit">
            <strong>Recent policy history</strong>
            {policyAudit.slice(0, 5).map((entry) => (
              <small key={`${entry.occurred_at}-${entry.action}`}>
                {entry.action.replaceAll("_", " ")} · {new Date(entry.occurred_at).toLocaleString()} · {entry.occurred_by ?? "system"}
              </small>
            ))}
          </div>
        )}
      </section>

      <div className="concept-banner">
        <span className="concept-badge">{liveRisks === null ? "Preview data" : "Live data"}</span>
        {liveRisks === null && (
          <span>
            {liveMessage ?? "Loading on-demand wait risks; review scenarios are shown meanwhile."}
          </span>
        )}
        <span>
          Current wait-risk records are provided by the vendor-neutral on-demand monitoring contract.
        </span>
      </div>

      <div className="risk-stat-grid" aria-label="On-demand service quality summary">
        <RiskStat value={predictedPoor} label="Predicted over standard" tone="warning" />
        <RiskStat value={currentlyPoor} label="Currently over standard" tone="danger" />
        <RiskStat value={unassigned} label="Unassigned at risk" tone="muted" />
        <RiskStat value={`${median} min`} label="Median predicted wait" tone="accent" />
      </div>

      {risks.length === 0 ? (
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
          isPreview={liveRisks === null}
          previewDraft={previewDrafts[selected.id] ?? null}
          preparing={preparing}
          prepareError={prepareError}
          serviceStandard={standardFor(selected)}
          onPrepare={() => void prepareUpdate(selected)}
          onWorkflow={(state) => setWorkflow((current) => ({ ...current, [selected.id]: state }))}
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
  previewDraft,
  preparing,
  prepareError,
  serviceStandard,
  onPrepare,
  onWorkflow,
}: {
  risk: OnDemandRisk;
  workflow: RiskWorkflow;
  isPreview: boolean;
  previewDraft: string | null;
  preparing: boolean;
  prepareError: string | null;
  serviceStandard: number;
  onPrepare: () => void;
  onWorkflow: (workflow: RiskWorkflow) => void;
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
        <strong>{risk.nearestEligibleVehicle}</strong>
        <small>
          {risk.availableVehicles} eligible vehicle{risk.availableVehicles === 1 ? "" : "s"} available in zone
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
        <button className="btn-primary" disabled={preparing} onClick={onPrepare}>
          {preparing
            ? "Preparing…"
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
        <button className="btn-sm" onClick={() => onWorkflow("Acknowledged")}>Acknowledge</button>
        <button className="btn-sm" onClick={() => onWorkflow("Monitoring")}>Monitor</button>
      </div>
    </aside>
  );
}
