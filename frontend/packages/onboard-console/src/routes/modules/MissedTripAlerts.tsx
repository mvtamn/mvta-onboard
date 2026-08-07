import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type GtfsRouteOption, type MissedTrip, type MissedTripsMonthlySummaryRow, type OtpReasonCode } from "@mvta/shared";
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

// "250 min ago" doesn't read at a glance - once it's been over an hour,
// switch to "4h 10m ago" (or "4h ago" on the hour) instead of letting the
// raw minute count grow unbounded.
function agoLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h ago` : `${hours}h ${mins}m ago`;
}

// Trip identifier the way staff actually recognize it - scheduled departure
// time + direction (e.g. "1245-SB"), the same time+direction convention
// Avail's own reports use for their "Trip" column - not the raw GTFS
// trip_id (e.g. "t52C-b2E-sl2B-v62"), which is an opaque static-feed key
// that means nothing to a reviewer scanning a list. Falls back to whichever
// half is available if the other is missing (direction_label can be null -
// see GtfsTripDirections' migration-007 comment).
function tripCode(scheduledDepartureAt: string | null, direction: string | null): string {
  const time = scheduledDepartureAt ? new Date(scheduledDepartureAt) : null;
  const timePart =
    time && !Number.isNaN(time.getTime())
      ? `${String(time.getHours()).padStart(2, "0")}${String(time.getMinutes()).padStart(2, "0")}`
      : null;
  if (timePart && direction) return `${timePart}-${direction}`;
  return timePart ?? direction ?? "—";
}

// "YYYYMM" -> "MM/YYYY" - a small local duplicate of the same helper OTP's
// module keeps for itself (otp/OtpModule.tsx's formatServiceMonth); this
// module isn't otherwise coupled to OTP's code, so it gets its own copy
// rather than importing across unrelated console modules for two lines.
function formatServiceMonth(yyyymm: string): string {
  if (!/^\d{6}$/.test(yyyymm)) return yyyymm;
  return `${yyyymm.slice(4, 6)}/${yyyymm.slice(0, 4)}`;
}

function fromMissedTrip(trip: MissedTrip): MissedTripAlert {
  return {
    id: `${trip.trip_id}-${trip.service_date}`,
    tripId: trip.trip_id,
    serviceDate: trip.service_date,
    route: trip.route_id,
    direction: trip.direction_label,
    detectionType: trip.detection_type,
    scheduledDepartureAt: trip.scheduled_departure_at,
    graceDeadlineAt: trip.grace_deadline_at,
    status: trip.status,
    detectedLateArrivalAt: trip.detected_late_arrival_at,
    firstSeenWatchingAt: trip.first_seen_watching_at,
    suggestedAlertId: trip.suggested_alert_id,
    validationStatus: trip.validation_status,
    reasonCode: trip.reason_code,
    validatedBy: trip.validated_by,
    validatedAt: trip.validated_at,
    notes: trip.notes,
  };
}

// A detection hit isn't a confirmed missed trip yet - only a human review
// (validationStatus === "confirmed") should earn the alarming "Missed"
// wording/color. Until then it's a candidate under investigation, so an
// escalated-but-unreviewed row reads as "Potential missed" in amber rather
// than a flat, unearned "Missed" in red.
function statusClass(status: MissedTripAlert["status"], validationStatus: MissedTripAlert["validationStatus"]): string {
  if (status === "watching") return "pill-warning";
  if (status === "resolved") return "pill-success";
  return validationStatus === "confirmed" ? "pill-danger" : "pill-warning";
}

function statusLabel(status: MissedTripAlert["status"], validationStatus: MissedTripAlert["validationStatus"]): string {
  if (status === "watching") return "Watching";
  if (status === "resolved") return "Resolved late";
  return validationStatus === "confirmed" ? "Missed" : "Potential missed";
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

// "Is there any way to determine why the flag exists?" - added by
// migration-023. Rows flagged before that migration ran read back null;
// shown honestly rather than guessed.
function detectionTypeLabel(type: MissedTripAlert["detectionType"]): string {
  if (type === "explicit_cancellation") return "Explicit cancellation (GTFS-RT)";
  if (type === "silent_no_show") return "Scheduled no-show (never observed)";
  return "Unknown — flagged before detection tracking was added";
}

function routeLabel(routeId: string, routesById: Map<string, GtfsRouteOption>): string {
  const r = routesById.get(routeId);
  const shortName = r?.route_short_name?.trim();
  const longName = r?.route_long_name?.trim();
  // route_short_name is the same string as route_id for MVTA's numbered
  // routes (e.g. both "420") - appending it back on would just read as
  // "Route 420 · 420". Fall through to route_long_name (the actual
  // descriptive name) whenever short_name doesn't add anything beyond the
  // number already shown.
  const name = shortName && shortName !== routeId ? shortName : longName;
  return name ? `Route ${routeId} · ${name}` : `Route ${routeId}`;
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
  const [view, setView] = useState<"investigation" | "monthly">("investigation");
  const [routesList, setRoutesList] = useState<GtfsRouteOption[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .getRoutes()
      .then((d) => alive && setRoutesList(d.routes))
      .catch(() => alive && setRoutesList([]));
    return () => {
      alive = false;
    };
  }, []);

  const routesById = useMemo(() => new Map(routesList.map((r) => [r.route_id, r])), [routesList]);

  return (
    <div className="risk-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">Compliance investigation</span>
          <h2>Missed Trips</h2>
          <p>
            Trips flagged by detection criteria (explicit cancellations and scheduled trips that never
            departed) are saved here for staff to investigate and validate — this is not a customer
            notification queue.
          </p>
        </div>
        <div className="risk-view-toggle" aria-label="Missed Trips view">
          <button className={view === "investigation" ? "active" : ""} onClick={() => setView("investigation")}>
            Investigation
          </button>
          <button className={view === "monthly" ? "active" : ""} onClick={() => setView("monthly")}>
            Monthly Assessments
          </button>
        </div>
      </div>

      {view === "investigation" ? (
        <MissedTripsInvestigationPage routesById={routesById} />
      ) : (
        <MissedTripsMonthlyPage routesById={routesById} />
      )}
    </div>
  );
}

function MissedTripsInvestigationPage({ routesById }: { routesById: Map<string, GtfsRouteOption> }) {
  const [liveAlerts, setLiveAlerts] = useState<MissedTripAlert[] | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [selectedId, setSelectedId] = useState(MISSED_TRIP_ALERTS[0].id);
  const [notesDraft, setNotesDraft] = useState("");
  const [reasonDraft, setReasonDraft] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [previewValidations, setPreviewValidations] = useState<
    Record<string, Pick<MissedTripAlert, "validationStatus" | "reasonCode" | "validatedBy" | "validatedAt" | "notes">>
  >({});
  const [reasonCodes, setReasonCodes] = useState<OtpReasonCode[]>([]);

  // Route + date filters, requested alongside the rest of this pass -
  // Missed Trips had no way to narrow the (potentially large) flagged-trip
  // list down to one route or one service date.
  const [routeFilter, setRouteFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  // "List" is the original card-row layout (Service/Detection/Review,
  // drives the detail pane beside it) - "Table" is an addition, not a
  // replacement: a Trip/Route/Direction/Detection/Review table for
  // scanning many rows at once, the way Avail's own reports read. Picking
  // a row in Table mode jumps back to List mode with that trip selected,
  // so it's a shortcut into investigation rather than a dead end.
  const [layout, setLayout] = useState<"list" | "table">("list");

  const isPreview = liveAlerts === null;
  const alerts = useMemo(
    () =>
      liveAlerts ??
      MISSED_TRIP_ALERTS.map((a) => (previewValidations[a.id] ? { ...a, ...previewValidations[a.id] } : a)),
    [liveAlerts, previewValidations],
  );
  // "resolved" means the trip did eventually depart within the grace
  // window - the detector self-corrected, there's nothing left to
  // investigate. Leaving those in this list buried the small number of
  // rows actually needing staff attention under a growing pile of
  // already-settled history; the Monthly Assessments tab is where that
  // history belongs.
  const activeAlerts = useMemo(() => alerts.filter((a) => a.status !== "resolved"), [alerts]);
  const selected = useMemo(
    () => activeAlerts.find((a) => a.id === selectedId) ?? activeAlerts[0] ?? MISSED_TRIP_ALERTS[0],
    [activeAlerts, selectedId],
  );

  const routeOptions = useMemo(
    () => [...new Set(activeAlerts.map((a) => a.route))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [activeAlerts],
  );
  const filteredAlerts = useMemo(
    () =>
      activeAlerts.filter(
        (a) => (!routeFilter || a.route === routeFilter) && (!dateFilter || a.serviceDate === dateFilter),
      ),
    [activeAlerts, routeFilter, dateFilter],
  );

  useEffect(() => {
    setNotesDraft(selected.notes ?? "");
    setReasonDraft(selected.reasonCode ?? "");
    setValidateError(null);
  }, [selected.id, selected.notes, selected.reasonCode]);

  useEffect(() => {
    let alive = true;
    api
      .getReasonCodes("missed_trip", true)
      .then((d) => alive && setReasonCodes(d.reason_codes))
      .catch(() => alive && setReasonCodes([]));
    return () => {
      alive = false;
    };
  }, []);

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
        const mappedActive = mapped.filter((m) => m.status !== "resolved");
        if (mappedActive.length > 0) {
          setSelectedId((current) => (mappedActive.some((m) => m.id === current) ? current : mappedActive[0].id));
        }
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
          reasonCode: reasonDraft || null,
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
        reason_code: reasonDraft || null,
      });
      load();
    } catch (err) {
      setValidateError(err instanceof ApiError ? err.message : "The review could not be saved.");
    } finally {
      setValidating(false);
    }
  }

  const unreviewed = activeAlerts.filter((a) => a.validationStatus === "unreviewed").length;
  const confirmed = activeAlerts.filter((a) => a.validationStatus === "confirmed").length;
  const falsePositives = activeAlerts.filter((a) => a.validationStatus === "false_positive").length;
  const routesAffected = new Set(activeAlerts.map((a) => a.route)).size;

  // Computed once, outside the list-vs-table branches below - referencing
  // `layout` from inside a branch that already narrowed it to one literal
  // makes the other comparison look tautologically false to TS (TS2367),
  // even though both buttons need to render in both branches.
  const currentLayout: "list" | "table" = layout;
  const layoutToggle = (
    <div className="risk-view-toggle risk-view-toggle-sm" aria-label="Flagged trips layout">
      <button className={currentLayout === "list" ? "active" : ""} onClick={() => setLayout("list")}>List</button>
      <button className={currentLayout === "table" ? "active" : ""} onClick={() => setLayout("table")}>Table</button>
    </div>
  );

  return (
    <>
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

      {activeAlerts.length === 0 ? (
        <div className="risk-empty-state">
          <strong>No missed trips</strong>
          <span>No canceled or no-show trips are currently flagged for review.</span>
        </div>
      ) : layout === "table" ? (
        <section className="risk-list-panel missed-trips-table-panel" aria-label="Missed trips">
          <div className="risk-section-head">
            <div>
              <span className="risk-eyebrow">Needs investigation</span>
              <h3>Flagged trips</h3>
            </div>
            <div className="risk-section-head-actions">
              <span className="risk-count">{filteredAlerts.length} of {activeAlerts.length} trips</span>
              {layoutToggle}
            </div>
          </div>

          <div className="risk-list-toolbar" style={{ display: "flex", gap: 10, padding: "0 4px 10px" }}>
            <select className="f" value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
              <option value="">All routes</option>
              {routeOptions.map((r) => (
                <option key={r} value={r}>{routeLabel(r, routesById)}</option>
              ))}
            </select>
            <input
              className="f"
              type="date"
              value={dateFilter ? `${dateFilter.slice(0, 4)}-${dateFilter.slice(4, 6)}-${dateFilter.slice(6, 8)}` : ""}
              onChange={(e) => setDateFilter(e.target.value ? e.target.value.replace(/-/g, "") : "")}
              aria-label="Filter by service date"
            />
            {routeFilter || dateFilter ? (
              <button className="btn-sm" onClick={() => { setRouteFilter(""); setDateFilter(""); }}>
                Clear filters
              </button>
            ) : null}
          </div>

          <div className="missed-trips-table-scroll">
            <table className="data missed-trips-table">
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Route</th>
                  <th>Direction</th>
                  <th>Detection</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-note">No trips match these filters.</td>
                  </tr>
                ) : (
                  filteredAlerts.map((alert) => {
                    const goToDetail = () => {
                      setSelectedId(alert.id);
                      setLayout("list");
                    };
                    return (
                      <tr
                        key={alert.id}
                        className="missed-trip-row"
                        onClick={goToDetail}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            goToDetail();
                          }
                        }}
                        tabIndex={0}
                      >
                        <td><strong>{tripCode(alert.scheduledDepartureAt, alert.direction)}</strong></td>
                        <td>{routeLabel(alert.route, routesById)}</td>
                        <td className="td-dim">{alert.direction ?? "—"}</td>
                        <td>
                          <span className={`pill-sm ${statusClass(alert.status, alert.validationStatus)}`}>
                            {statusLabel(alert.status, alert.validationStatus)}
                          </span>
                          <div className="td-dim" style={{ marginTop: 4 }}>
                            {timeLabel(alert.graceDeadlineAt)} · {agoLabel(minutesAgo(alert.graceDeadlineAt))}
                          </div>
                        </td>
                        <td>
                          <span className={`pill-sm ${validationClass(alert.validationStatus)}`}>
                            {validationLabel(alert.validationStatus)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="risk-workspace">
          <section className="risk-list-panel" aria-label="Missed trips">
            <div className="risk-section-head">
              <div>
                <span className="risk-eyebrow">Needs investigation</span>
                <h3>Flagged trips</h3>
              </div>
              <div className="risk-section-head-actions">
                <span className="risk-count">{filteredAlerts.length} of {activeAlerts.length} trips</span>
                {layoutToggle}
              </div>
            </div>

            <div className="risk-list-toolbar" style={{ display: "flex", gap: 10, padding: "0 4px 10px" }}>
              <select className="f" value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
                <option value="">All routes</option>
                {routeOptions.map((r) => (
                  <option key={r} value={r}>{routeLabel(r, routesById)}</option>
                ))}
              </select>
              <input
                className="f"
                type="date"
                value={dateFilter ? `${dateFilter.slice(0, 4)}-${dateFilter.slice(4, 6)}-${dateFilter.slice(6, 8)}` : ""}
                onChange={(e) => setDateFilter(e.target.value ? e.target.value.replace(/-/g, "") : "")}
                aria-label="Filter by service date"
              />
              {routeFilter || dateFilter ? (
                <button className="btn-sm" onClick={() => { setRouteFilter(""); setDateFilter(""); }}>
                  Clear filters
                </button>
              ) : null}
            </div>

            <div className="risk-list-head" aria-hidden="true">
              <span>Service</span>
              <span>Detection</span>
              <span>Review</span>
            </div>

            {filteredAlerts.length === 0 ? (
              <div className="empty-note" style={{ padding: "16px 4px" }}>No trips match these filters.</div>
            ) : null}

            {filteredAlerts.map((alert) => {
              const active = alert.id === selected.id;
              return (
                <button
                  className={`risk-list-row ${active ? "selected" : ""}`}
                  key={alert.id}
                  onClick={() => setSelectedId(alert.id)}
                  aria-pressed={active}
                >
                  <span className="risk-service">
                    <strong>{routeLabel(alert.route, routesById)}</strong>
                    <small>Scheduled {timeLabel(alert.scheduledDepartureAt)}</small>
                  </span>
                  <span className="risk-departure">
                    <span className={`pill-sm ${statusClass(alert.status, alert.validationStatus)}`}>
                      {statusLabel(alert.status, alert.validationStatus)}
                    </span>
                    <small>{timeLabel(alert.graceDeadlineAt)} · {agoLabel(minutesAgo(alert.graceDeadlineAt))}</small>
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
            routesById={routesById}
            reasonCodes={reasonCodes}
            reasonDraft={reasonDraft}
            onReasonChange={setReasonDraft}
            notesDraft={notesDraft}
            onNotesChange={setNotesDraft}
            validating={validating}
            validateError={validateError}
            onValidate={(status) => void validate(selected, status)}
          />
        </div>
      )}
    </>
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
  routesById,
  reasonCodes,
  reasonDraft,
  onReasonChange,
  notesDraft,
  onNotesChange,
  validating,
  validateError,
  onValidate,
}: {
  alert: MissedTripAlert;
  routesById: Map<string, GtfsRouteOption>;
  reasonCodes: OtpReasonCode[];
  reasonDraft: string;
  onReasonChange: (value: string) => void;
  notesDraft: string;
  onNotesChange: (value: string) => void;
  validating: boolean;
  validateError: string | null;
  onValidate: (status: "confirmed" | "false_positive") => void;
}) {
  const reviewed = alert.validationStatus !== "unreviewed";

  return (
    <aside className="risk-detail" aria-label={`${routeLabel(alert.route, routesById)} missed trip detail`}>
      <div className="risk-detail-head">
        <div>
          <span className="risk-eyebrow">Selected trip</span>
          <h3>Trip {tripCode(alert.scheduledDepartureAt, alert.direction)} · {routeLabel(alert.route, routesById)}</h3>
          <p>
            Service date {alert.serviceDate} · <span className="mono-ref">Ref {alert.tripId}</span>
          </p>
        </div>
        <span className={`pill-sm ${statusClass(alert.status, alert.validationStatus)}`}>
          {statusLabel(alert.status, alert.validationStatus)}
        </span>
      </div>

      <div className="risk-hero-metric">
        <span>Grace deadline</span>
        <strong>{timeLabel(alert.graceDeadlineAt)}</strong>
        <small>Scheduled departure {timeLabel(alert.scheduledDepartureAt)}</small>
      </div>

      <dl className="risk-facts">
        <div><dt>Detection status</dt><dd>{statusLabel(alert.status, alert.validationStatus)}</dd></div>
        <div><dt>Detection type</dt><dd>{detectionTypeLabel(alert.detectionType)}</dd></div>
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

        <label htmlFor="missed-trip-reason" className="field-label">Reason</label>
        <select
          id="missed-trip-reason"
          className="f"
          value={reasonDraft}
          onChange={(event) => onReasonChange(event.target.value)}
        >
          <option value="">Select a reason…</option>
          {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>

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
    </aside>
  );
}

interface MonthlyRow {
  service_month: string;
  route_id: string;
  cancellations: number;
  noShows: number;
  confirmed: number;
  falsePositive: number;
  unreviewed: number;
  total: number;
}

function pivotMonthlySummary(summary: MissedTripsMonthlySummaryRow[]): MonthlyRow[] {
  const byKey = new Map<string, MonthlyRow>();
  for (const r of summary) {
    const key = `${r.service_month}-${r.route_id}`;
    const row = byKey.get(key) ?? {
      service_month: r.service_month,
      route_id: r.route_id,
      cancellations: 0,
      noShows: 0,
      confirmed: 0,
      falsePositive: 0,
      unreviewed: 0,
      total: 0,
    };
    if (r.detection_type === "explicit_cancellation") row.cancellations += r.trip_count;
    if (r.detection_type === "silent_no_show") row.noShows += r.trip_count;
    if (r.validation_status === "confirmed") row.confirmed += r.trip_count;
    if (r.validation_status === "false_positive") row.falsePositive += r.trip_count;
    if (r.validation_status === "unreviewed") row.unreviewed += r.trip_count;
    row.total += r.trip_count;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => b.service_month.localeCompare(a.service_month) || a.route_id.localeCompare(b.route_id, undefined, { numeric: true }),
  );
}

// Monthly Assessments - requested alongside the rest of this pass, mirroring
// OTP Compliance's own Monthly Assessments page for the same "how are we
// trending, not just what's pending right now" question.
function MissedTripsMonthlyPage({ routesById }: { routesById: Map<string, GtfsRouteOption> }) {
  const [summary, setSummary] = useState<MissedTripsMonthlySummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getMissedTripsMonthlySummary()
      .then((d) => alive && setSummary(d.summary))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : "Could not load the monthly summary."));
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => (summary ? pivotMonthlySummary(summary) : []), [summary]);

  if (error) {
    return <div className="subcard empty-note">{error}</div>;
  }
  if (summary === null) {
    return <div className="subcard empty-note">Loading monthly history…</div>;
  }
  if (rows.length === 0) {
    return <div className="subcard empty-note">No missed-trip history yet.</div>;
  }

  return (
    <div className="subcard" style={{ overflow: "hidden" }}>
      <table className="data">
        <thead>
          <tr>
            <th>Month</th>
            <th>Route</th>
            <th>Cancellations</th>
            <th>No-shows</th>
            <th>Confirmed</th>
            <th>False positives</th>
            <th>Unreviewed</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.service_month}-${r.route_id}`}>
              <td>{formatServiceMonth(r.service_month)}</td>
              <td>{routeLabel(r.route_id, routesById)}</td>
              <td>{r.cancellations}</td>
              <td>{r.noShows}</td>
              <td>{r.confirmed}</td>
              <td>{r.falsePositive}</td>
              <td>{r.unreviewed}</td>
              <td><b>{r.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
