import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type MissedTrip, type PrepareSuggestedAlertInput } from "@mvta/shared";
import { useNavigate } from "react-router-dom";
import { api } from "../../config.js";
import { MISSED_TRIP_ALERTS, type MissedTripAlert } from "./missedTrips.data.js";
import "./serviceRisk.css";

const AUTO_REFRESH_MS = 60_000;

function timeLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function minutesAgo(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
}

function fromMissedTrip(trip: MissedTrip): MissedTripAlert {
  return {
    id: `${trip.trip_id}-${trip.service_date}`,
    tripId: trip.trip_id,
    serviceDate: trip.service_date,
    route: trip.route_id,
    detectionType: "unknown",
    scheduledDepartureAt: trip.scheduled_departure_at,
    graceDeadlineAt: trip.grace_deadline_at,
    status: trip.status,
    detectedLateArrivalAt: trip.detected_late_arrival_at,
    firstSeenWatchingAt: trip.first_seen_watching_at,
    suggestedAlertId: trip.suggested_alert_id,
    validationStatus: trip.validation_status,
    validatedBy: trip.validated_by,
    validatedAt: trip.validated_at,
    notes: trip.notes,
  };
}

function statusClass(status: MissedTripAlert["status"]): string {
  if (status === "escalated") return "pill-danger";
  if (status === "watching") return "pill-warning";
  return "pill-success";
}

function statusLabel(status: MissedTripAlert["status"]): string {
  if (status === "escalated") return "Missed";
  if (status === "watching") return "Watching";
  return "Resolved late";
}

function validationClass(status: MissedTripAlert["validationStatus"]): string {
  if (status === "unreviewed") return "pill-warning";
  if (status === "confirmed") return "pill-danger";
  return "pill-muted";
}

function validationLabel(status: MissedTripAlert["validationStatus"]): string {
  if (status === "unreviewed") return "Unreviewed";
  if (status === "confirmed") return "Confirmed";
  return "False positive";
}

function missedTripDraft(alert: MissedTripAlert): PrepareSuggestedAlertInput {
  const kind = alert.detectionType === "canceled" ? "canceled" : "did not depart as scheduled";
  return {
    source: "missed_trip",
    external_id: `${alert.detectionType === "canceled" ? "cancel" : "noshow"}:${alert.serviceDate}:${alert.tripId}`.slice(0, 100),
    draft_text: `A Route ${alert.route} trip has ${kind === "canceled" ? "been canceled" : kind} and will not run as scheduled.`,
    category: "outage",
    severity: "major",
    routes_affected: [alert.route],
    detail: {
      detection_type: alert.detectionType,
      trip_id: alert.tripId,
      route_id: alert.route,
      service_date: alert.serviceDate,
      prepared_from: "occ_missed_trips",
    },
  };
}

function missedTripLoadError(err: unknown): string {
  if (
    import.meta.env.DEV &&
    String(import.meta.env.VITE_AUTH_MODE).toLowerCase() === "mock"
  ) {
    return (
      "Preview mode — this local development console uses mock sign-in and cannot open " +
      "protected missed-trip data. Use the deployed console for live data. Preview review " +
      "actions are not saved."
    );
  }
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return "Preview mode — your sign-in session was not accepted. Sign in again to restore live data.";
    }
    if (err.status === 403) {
      return "Preview mode — your account does not have a Missed Trips staff role.";
    }
    if (err.status >= 500) {
      return "Preview mode — the missed-trip service or database is temporarily unavailable.";
    }
    return `Preview mode — missed-trip data could not be loaded: ${err.message}`;
  }
  return "Preview mode — the console could not reach the missed-trip service.";
}

export function MissedTripAlerts() {
  const navigate = useNavigate();
  const [liveAlerts, setLiveAlerts] = useState<MissedTripAlert[] | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selectedId, setSelectedId] = useState(MISSED_TRIP_ALERTS[0].id);
  const [notesDraft, setNotesDraft] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [previewDrafts, setPreviewDrafts] = useState<Record<string, string>>({});
  const [previewValidations, setPreviewValidations] = useState<
    Record<string, Pick<MissedTripAlert, "validationStatus" | "validatedBy" | "validatedAt" | "notes">>
  >({});
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);

  const isPreview = liveAlerts === null;
  const alerts = useMemo(
    () =>
      liveAlerts ??
      MISSED_TRIP_ALERTS.map((a) => (previewValidations[a.id] ? { ...a, ...previewValidations[a.id] } : a)),
    [liveAlerts, previewValidations],
  );
  const selected = useMemo(
    () => alerts.find((a) => a.id === selectedId) ?? alerts[0] ?? MISSED_TRIP_ALERTS[0],
    [alerts, selectedId],
  );

  useEffect(() => {
    setNotesDraft(selected.notes ?? "");
    setValidateError(null);
  }, [selected.id, selected.notes]);

  const load = useCallback(() => {
    api
      .getMissedTrips()
      .then(({ missed_trips, diagnostics }) => {
        const mapped = missed_trips.map(fromMissedTrip);
        setLiveAlerts(mapped);
        setConfigured(diagnostics.configured);
        setLiveMessage(
          diagnostics.configured
            ? null
            : "Missed-trip schedule detection is not fully configured yet (migration pending); showing cancellation-only data.",
        );
        if (mapped.length > 0) setSelectedId((current) => (mapped.some((m) => m.id === current) ? current : mapped[0].id));
      })
      .catch((err) => {
        setLiveAlerts(null);
        setLiveMessage(missedTripLoadError(err));
      });
  }, []);

  useEffect(() => {
    load();
    const intervalId = window.setInterval(load, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [load]);

  async function validate(alert: MissedTripAlert, validationStatus: "confirmed" | "false_positive") {
    setValidateError(null);
    if (isPreview) {
      setPreviewValidations((current) => ({
        ...current,
        [alert.id]: {
          validationStatus,
          validatedBy: "Dev User (mock, preview only)",
          validatedAt: new Date().toISOString(),
          notes: notesDraft || null,
        },
      }));
      return;
    }
    setValidating(true);
    try {
      await api.validateMissedTrip({
        trip_id: alert.tripId,
        service_date: alert.serviceDate,
        validation_status: validationStatus,
        notes: notesDraft || undefined,
      });
      load();
    } catch (err) {
      setValidateError(err instanceof ApiError ? err.message : "The review could not be saved.");
    } finally {
      setValidating(false);
    }
  }

  async function prepareAlert(alert: MissedTripAlert) {
    setPrepareError(null);
    const draft = missedTripDraft(alert);
    if (isPreview) {
      setPreviewDrafts((current) => ({ ...current, [alert.id]: draft.draft_text }));
      return;
    }
    if (alert.suggestedAlertId) {
      navigate(`/suggested?focus=${encodeURIComponent(alert.suggestedAlertId)}`);
      return;
    }
    setPreparing(true);
    try {
      const result = await api.prepareSuggestedAlert(draft);
      navigate(`/suggested?focus=${encodeURIComponent(result.alert_id)}`);
    } catch (err) {
      setPrepareError(err instanceof ApiError ? err.message : "The alert draft could not be prepared.");
    } finally {
      setPreparing(false);
    }
  }

  const unreviewed = alerts.filter((a) => a.validationStatus === "unreviewed").length;
  const confirmed = alerts.filter((a) => a.validationStatus === "confirmed").length;
  const falsePositives = alerts.filter((a) => a.validationStatus === "false_positive").length;
  const routesAffected = new Set(alerts.map((a) => a.route)).size;

  return (
    <div className="risk-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">Compliance investigation</span>
          <h2>Missed Trips</h2>
          <p>
            Trips flagged by detection criteria (explicit cancellations and scheduled trips that never
            departed) are saved here for staff to investigate and validate — this is not a customer
            notification queue. Refreshes every 60 seconds.
          </p>
        </div>
      </div>

      <div className="concept-banner">
        <span className="concept-badge">
          {isPreview ? "Preview data" : configured ? "Live data" : "Partial data"}
        </span>
        <span>{liveMessage ?? "Authenticated missed-trip detection is connected."}</span>
      </div>

      <div className="risk-stat-grid" aria-label="Missed trip review summary">
        <RiskStat value={unreviewed} label="Unreviewed" tone="warning" />
        <RiskStat value={confirmed} label="Confirmed" tone="danger" />
        <RiskStat value={falsePositives} label="False positives" tone="muted" />
        <RiskStat value={routesAffected} label="Routes affected" tone="accent" />
      </div>

      {alerts.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No missed trips</strong>
          <span>No canceled or no-show trips are currently flagged for review.</span>
        </div>
      ) : (
        <div className="risk-workspace">
          <section className="risk-list-panel" aria-label="Missed trips">
            <div className="risk-section-head">
              <div>
                <span className="risk-eyebrow">Needs investigation</span>
                <h3>Flagged trips</h3>
              </div>
              <span className="risk-count">{alerts.length} trips</span>
            </div>

            <div className="risk-list-head" aria-hidden="true">
              <span>Service</span>
              <span>Detection</span>
              <span>Review</span>
            </div>

            {alerts.map((alert) => {
              const active = alert.id === selected.id;
              return (
                <button
                  className={`risk-list-row ${active ? "selected" : ""}`}
                  key={alert.id}
                  onClick={() => setSelectedId(alert.id)}
                  aria-pressed={active}
                >
                  <span className="risk-service">
                    <strong>Route {alert.route}</strong>
                    <small>Trip {alert.tripId}</small>
                  </span>
                  <span className="risk-departure">
                    <span className={`pill-sm ${statusClass(alert.status)}`}>{statusLabel(alert.status)}</span>
                    <small>{timeLabel(alert.graceDeadlineAt)} · {minutesAgo(alert.graceDeadlineAt) ?? "—"} min ago</small>
                  </span>
                  <span className="risk-threshold">
                    <span className={`pill-sm ${validationClass(alert.validationStatus)}`}>
                      {validationLabel(alert.validationStatus)}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>

          <MissedTripDetail
            alert={selected}
            isPreview={isPreview}
            notesDraft={notesDraft}
            onNotesChange={setNotesDraft}
            validating={validating}
            validateError={validateError}
            onValidate={(status) => void validate(selected, status)}
            previewDraft={previewDrafts[selected.id] ?? null}
            preparing={preparing}
            prepareError={prepareError}
            onPrepare={() => void prepareAlert(selected)}
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

function MissedTripDetail({
  alert,
  isPreview,
  notesDraft,
  onNotesChange,
  validating,
  validateError,
  onValidate,
  previewDraft,
  preparing,
  prepareError,
  onPrepare,
}: {
  alert: MissedTripAlert;
  isPreview: boolean;
  notesDraft: string;
  onNotesChange: (value: string) => void;
  validating: boolean;
  validateError: string | null;
  onValidate: (status: "confirmed" | "false_positive") => void;
  previewDraft: string | null;
  preparing: boolean;
  prepareError: string | null;
  onPrepare: () => void;
}) {
  const reviewed = alert.validationStatus !== "unreviewed";

  return (
    <aside className="risk-detail" aria-label={`Route ${alert.route} missed trip detail`}>
      <div className="risk-detail-head">
        <div>
          <span className="risk-eyebrow">Selected trip</span>
          <h3>Route {alert.route}</h3>
          <p>Trip {alert.tripId} · Service date {alert.serviceDate}</p>
        </div>
        <span className={`pill-sm ${statusClass(alert.status)}`}>{statusLabel(alert.status)}</span>
      </div>

      <div className="risk-hero-metric">
        <span>Grace deadline</span>
        <strong>{timeLabel(alert.graceDeadlineAt)}</strong>
        <small>Scheduled departure {timeLabel(alert.scheduledDepartureAt)}</small>
      </div>

      <dl className="risk-facts">
        <div><dt>Detection status</dt><dd>{statusLabel(alert.status)}</dd></div>
        <div><dt>First flagged</dt><dd>{timeLabel(alert.firstSeenWatchingAt)}</dd></div>
        <div>
          <dt>Detected late arrival</dt>
          <dd>{alert.detectedLateArrivalAt ? timeLabel(alert.detectedLateArrivalAt) : "Not observed"}</dd>
        </div>
      </dl>

      <div className="risk-detail-section">
        <div className="risk-section-title-row">
          <h4>Investigation</h4>
          <span className={`pill-sm ${validationClass(alert.validationStatus)}`}>
            {validationLabel(alert.validationStatus)}
          </span>
        </div>
        {reviewed ? (
          <p className="risk-unknown">
            {alert.validatedBy ?? "A reviewer"} recorded this as {validationLabel(alert.validationStatus).toLowerCase()}
            {alert.validatedAt ? ` at ${timeLabel(alert.validatedAt)}` : ""}.
          </p>
        ) : null}
        <label htmlFor="missed-trip-notes" className="field-label">Investigation notes</label>
        <textarea
          id="missed-trip-notes"
          className="compose"
          rows={3}
          value={notesDraft}
          onChange={(event) => onNotesChange(event.target.value)}
          placeholder="e.g. Confirmed via dispatch log - vehicle never left the garage."
        />
        {validateError ? <p className="risk-action-error">{validateError}</p> : null}
        <div className="risk-actions">
          <button className="btn-primary" disabled={validating} onClick={() => onValidate("confirmed")}>
            {validating ? "Saving…" : "Confirm missed trip"}
          </button>
          <button className="btn-sm" disabled={validating} onClick={() => onValidate("false_positive")}>
            Mark false positive
          </button>
        </div>
      </div>

      {previewDraft ? (
        <div className="risk-draft-preview" role="status">
          <span>Customer alert preview — not saved</span>
          <p>{previewDraft}</p>
        </div>
      ) : null}
      {prepareError ? <p className="risk-action-error">{prepareError}</p> : null}

      <div className="risk-detail-section">
        <h4>Rider notification (optional)</h4>
        <p className="risk-unknown">
          Only prepare a rider notice if the investigation determines customers should be informed.
        </p>
        <button className="btn-sm" disabled={preparing} onClick={onPrepare}>
          {preparing
            ? "Preparing…"
            : isPreview
              ? "Preview alert draft"
              : alert.suggestedAlertId
                ? "Review prepared alert"
                : "Prepare rider alert"}
        </button>
      </div>
    </aside>
  );
}
