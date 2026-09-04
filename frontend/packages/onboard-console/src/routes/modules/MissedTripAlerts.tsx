import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type GtfsRouteOption, type MissedTrip, type MissedTripReview, type MissedTripsDiagnostics, type MissedTripsMonthlySummaryRow, type OtpReasonCode } from "@mvta/shared";
import { api } from "../../config.js";
import { KpiTrustSummary } from "./KpiTrustSummary.js";
import { MISSED_TRIP_ALERTS, type MissedTripAlert } from "./missedTrips.data.js";
import "./serviceRisk.css";

const AUTO_REFRESH_MS = 60_000;
const DEV_MOCK_PREVIEW = import.meta.env.DEV && String(import.meta.env.VITE_AUTH_MODE).toLowerCase() === "mock";

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
//
// The hour tier needs the same ceiling for the same reason: capping minutes at
// 60 while letting hours run free just moved the unbounded count up one tier,
// so a row untouched overnight read "26h 14m ago" and one left over a weekend
// "73h 5m ago". Rows here legitimately live for days - AGING_HOURS is 24 and
// OVERDUE_HOURS 72 - so the day tier is the common case for anything overdue,
// not an edge case.
export function agoLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const mins = minutes % 60;
    return mins === 0 ? `${hours}h ago` : `${hours}h ${mins}m ago`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d ago` : `${days}d ${remainingHours}h ago`;
}

// Missed Trips feeds the Contractor Performance Assessment's MISSED_TRIPS_FR
// KPI once a reviewer confirms a row (plans/ContractorPerformanceAssessment_
// Design.md SS3/SS6 - "Auto-candidate from MonitoredMissedTrips
// (validation_status='confirmed')") - and that assessment computes on a
// monthly, per-contractor-month cadence. An unreviewed trip sitting for days
// isn't just clutter in this queue: if it slips past its service month's
// assessment period before anyone reviews it, catching it later means
// reopening an already-finalized period, which the design treats as a
// deliberate manager decision, not a side effect. Age is measured from
// firstSeenWatchingAt (when the row was first flagged), not from now vs.
// scheduled time, since that's when the review clock actually starts.
const AGING_HOURS = 24;
const OVERDUE_HOURS = 72;

function reviewAgeHours(firstSeenWatchingAt: string): number | null {
  const date = new Date(firstSeenWatchingAt);
  return Number.isNaN(date.getTime()) ? null : (Date.now() - date.getTime()) / 3_600_000;
}

// Only unreviewed rows carry review urgency - once a reviewer has acted
// there's nothing left pending, however old the row is.
function agingBadge(alert: MissedTripAlert): { label: string; className: string } | null {
  if (alert.validationStatus !== "unreviewed") return null;
  const hours = reviewAgeHours(alert.firstSeenWatchingAt);
  if (hours === null) return null;
  if (hours >= OVERDUE_HOURS) return { label: "Overdue", className: "pill-danger" };
  if (hours >= AGING_HOURS) return { label: "Aging", className: "pill-warning" };
  return null;
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

function formatServiceDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return yyyymmdd;
  const date = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T12:00:00`);
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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
    detectorVersion: trip.detector_version,
    dataQualityStatus: trip.data_quality_status,
    sourceSystem: trip.source_system,
    sourceRecordId: trip.source_record_id,
    conditionLateStart: trip.condition_late_start,
    conditionSuperseded: trip.condition_superseded,
    conditionLateArrival: trip.condition_late_arrival,
    startDelaySeconds: trip.start_delay_seconds,
    arrivalDelaySeconds: trip.arrival_delay_seconds,
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
  if (status === "resolved") return "Operated within window";
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
  if (type === "spare_late_start") return "Spare pickup started over 30 minutes late";
  if (type === "spare_superseded") return "Spare request superseded by the next same-duty pickup";
  if (type === "spare_late_arrival") return "Spare dropoff arrived at least 30 minutes late";
  if (type === "spare_multiple") return "Multiple Spare missed-trip conditions";
  return "Unknown — flagged before detection tracking was added";
}

function dataQualityLabel(status: MissedTripAlert["dataQualityStatus"]): string {
  if (status === "source_verified") return "Source verified";
  if (status === "experimental") return "Experimental detector";
  return "Legacy — unverified";
}

function sourceLabel(source: MissedTripAlert["sourceSystem"]): string {
  return source === "spare" ? "Spare" : "GTFS-Realtime";
}

function routeLabel(routeId: string, routesById: Map<string, GtfsRouteOption>, sourceSystem: "gtfs" | "spare" = "gtfs"): string {
  if (sourceSystem === "spare") return `Spare · ${routeId}`;
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
      return "Your sign-in session was not accepted. Sign in again to restore live data.";
    }
    if (err.status === 403) {
      return "Your account does not have a Missed Trips staff role.";
    }
    if (err.status >= 500) {
      return "The missed-trip service or database is temporarily unavailable.";
    }
    return `Missed-trip data could not be loaded: ${err.message}`;
  }
  return "The console could not reach the missed-trip service.";
}

export function MissedTripAlerts() {
  const [view, setView] = useState<"investigation" | "history" | "monthly">("investigation");
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
            Source-backed missed-trip candidates are saved here for staff to investigate and validate.
            Machine detection is evidence, not a final compliance finding or customer notification.
          </p>
        </div>
        <div className="risk-view-toggle" aria-label="Missed Trips view">
          <button className={view === "investigation" ? "active" : ""} onClick={() => setView("investigation")}>
            Review queue
          </button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            History
          </button>
          <button className={view === "monthly" ? "active" : ""} onClick={() => setView("monthly")}>
            Monthly Assessments
          </button>
        </div>
      </div>

      <KpiTrustSummary stream={["fixed_route_missed_trips", "spare_missed_trips"]} />

      {view === "investigation" || view === "history" ? (
        <MissedTripsInvestigationPage
          routesById={routesById}
          mode={view === "history" ? "history" : "queue"}
        />
      ) : (
        <MissedTripsMonthlyPage routesById={routesById} />
      )}
    </div>
  );
}

function MissedTripsInvestigationPage({
  routesById,
  mode,
}: {
  routesById: Map<string, GtfsRouteOption>;
  mode: "queue" | "history";
}) {
  const [liveAlerts, setLiveAlerts] = useState<MissedTripAlert[]>([]);
  const [dataMode, setDataMode] = useState<"loading" | "live" | "preview" | "error">("loading");
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [diagnostics, setDiagnostics] = useState<MissedTripsDiagnostics | null>(null);
  const [pageLimit, setPageLimit] = useState(200);
  const [displayPageSize, setDisplayPageSize] = useState(10);
  const [displayPage, setDisplayPage] = useState(0);
  const [selectedId, setSelectedId] = useState(MISSED_TRIP_ALERTS[0].id);
  const [notesDraft, setNotesDraft] = useState("");
  const [reasonDraft, setReasonDraft] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [previewValidations, setPreviewValidations] = useState<
    Record<string, Pick<MissedTripAlert, "validationStatus" | "reasonCode" | "validatedBy" | "validatedAt" | "notes">>
  >({});
  const [reasonCodes, setReasonCodes] = useState<OtpReasonCode[]>([]);
  const [reviews, setReviews] = useState<MissedTripReview[]>([]);

  // Route + date filters, requested alongside the rest of this pass -
  // Missed Trips had no way to narrow the (potentially large) flagged-trip
  // list down to one route or one service date.
  const [routeFilter, setRouteFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "spare" | "gtfs">("all");

  // "List" is the original card-row layout (Service/Detection/Review,
  // drives the detail pane beside it) - "Table" is an addition, not a
  // replacement: a Trip/Route/Direction/Detection/Review table for
  // scanning many rows at once, the way Avail's own reports read. Picking
  // a row in Table mode selects the same detail record without changing the
  // reviewer's chosen layout.
  const [layout, setLayout] = useState<"list" | "table">("list");

  const isPreview = dataMode === "preview";
  const alerts = useMemo(
    () =>
      isPreview
        ? MISSED_TRIP_ALERTS.map((a) => (previewValidations[a.id] ? { ...a, ...previewValidations[a.id] } : a))
        : liveAlerts,
    [isPreview, liveAlerts, previewValidations],
  );
  // "resolved" means the trip did eventually depart within the grace
  // window - the detector self-corrected, there's nothing left to
  // investigate. Leaving those in this list buried the small number of
  // rows actually needing staff attention under a growing pile of
  // already-settled history; the Monthly Assessments tab is where that
  // history belongs.
  const activeAlerts = useMemo(
    () => alerts.filter((a) => mode === "queue"
      ? a.status !== "resolved" && a.validationStatus === "unreviewed"
      : a.status === "resolved" || a.validationStatus !== "unreviewed"),
    [alerts, mode],
  );
  const sourceAlerts = useMemo(
    () => sourceFilter === "all" ? activeAlerts : activeAlerts.filter((alert) => alert.sourceSystem === sourceFilter),
    [activeAlerts, sourceFilter],
  );
  const routeOptions = useMemo(
    () => [...new Set(sourceAlerts.map((a) => a.route))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [sourceAlerts],
  );
  const filteredAlerts = useMemo(
    () =>
      sourceAlerts.filter(
        (a) => (!routeFilter || a.route === routeFilter) && (!dateFilter || a.serviceDate === dateFilter),
      ),
    [sourceAlerts, routeFilter, dateFilter],
  );
  // Selected from the fully-filtered set, not the mode-only `activeAlerts` -
  // otherwise a trip excluded by the route/date/source filters could still be
  // shown (and reviewed) in the detail pane while the list itself reports "No
  // trips match these filters", which is exactly the confusing state a
  // reviewer should never see. `null` when the filters exclude everything;
  // the detail pane renders an empty state in that case instead of falling
  // back to an out-of-scope trip.
  const selected = useMemo(
    () => filteredAlerts.find((a) => a.id === selectedId) ?? filteredAlerts[0] ?? null,
    [filteredAlerts, selectedId],
  );
  const displayPageCount = Math.max(1, Math.ceil(filteredAlerts.length / displayPageSize));
  const effectiveDisplayPage = Math.min(displayPage, displayPageCount - 1);
  const visibleAlerts = useMemo(
    () => filteredAlerts.slice(
      effectiveDisplayPage * displayPageSize,
      (effectiveDisplayPage + 1) * displayPageSize,
    ),
    [effectiveDisplayPage, displayPageSize, filteredAlerts],
  );
  const displayStart = filteredAlerts.length === 0 ? 0 : effectiveDisplayPage * displayPageSize + 1;
  const displayEnd = Math.min(filteredAlerts.length, (effectiveDisplayPage + 1) * displayPageSize);

  useEffect(() => {
    setPageLimit(200);
    setDisplayPage(0);
  }, [mode]);

  useEffect(() => {
    setDisplayPage(0);
  }, [sourceFilter, routeFilter, dateFilter, displayPageSize]);

  useEffect(() => {
    if (displayPage !== effectiveDisplayPage) setDisplayPage(effectiveDisplayPage);
  }, [displayPage, effectiveDisplayPage]);

  useEffect(() => {
    if (visibleAlerts.length > 0 && !visibleAlerts.some((alert) => alert.id === selectedId)) {
      setSelectedId(visibleAlerts[0].id);
    }
  }, [selectedId, visibleAlerts]);

  useEffect(() => {
    setNotesDraft(selected?.notes ?? "");
    setReasonDraft(selected?.reasonCode ?? "");
    setValidateError(null);
  }, [selected?.id, selected?.notes, selected?.reasonCode]);

  useEffect(() => {
    let alive = true;
    if (isPreview || dataMode !== "live" || !selected) {
      setReviews([]);
      return () => { alive = false; };
    }
    api
      .getMissedTripReviews(selected.tripId, selected.serviceDate)
      .then((result) => alive && setReviews(result.reviews))
      .catch(() => alive && setReviews([]));
    return () => { alive = false; };
  }, [dataMode, isPreview, selected?.tripId, selected?.serviceDate]);

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
      .getMissedTrips(mode, pageLimit)
      .then(({ missed_trips, diagnostics }) => {
        const mapped = missed_trips.map(fromMissedTrip);
        setLiveAlerts(mapped);
        setDataMode("live");
        setConfigured(diagnostics.configured);
        setDiagnostics(diagnostics);
        setLiveMessage(
          !diagnostics.configured
            ? "Missed-trip feeds are not fully configured; results may be incomplete."
            : diagnostics.schedule_detection_status === "paused"
              ? "Schedule-based no-show detection is paused while start-evidence validation is completed. Explicit cancellations remain active."
              : null,
        );
        const mappedActive = mapped.filter((m) => mode === "queue"
          ? m.status !== "resolved" && m.validationStatus === "unreviewed"
          : m.status === "resolved" || m.validationStatus !== "unreviewed");
        if (mappedActive.length > 0) {
          setSelectedId((current) => (mappedActive.some((m) => m.id === current) ? current : mappedActive[0].id));
        }
      })
      .catch((err) => {
        setLiveAlerts([]);
        setDiagnostics(null);
        setDataMode(DEV_MOCK_PREVIEW ? "preview" : "error");
        setLiveMessage(missedTripLoadError(err));
      });
  }, [mode, pageLimit]);

  useEffect(() => {
    load();
    const intervalId = window.setInterval(load, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [load]);

  async function validate(alert: MissedTripAlert, validationStatus: "confirmed" | "false_positive") {
    setValidateError(null);
    if (!reasonDraft) {
      setValidateError("Select a reason before saving the review.");
      return;
    }
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
        reason_code: reasonDraft,
      });
      load();
    } catch (err) {
      setValidateError(err instanceof ApiError ? err.message : "The review could not be saved.");
    } finally {
      setValidating(false);
    }
  }

  // Sourced from `diagnostics` (a real database-wide aggregate) rather than
  // counted off `activeAlerts` whenever live data is available - `activeAlerts`
  // is both page-limited (capped at `pageLimit`, so "Unreviewed" would read as
  // a coincidental page-size number once the true count exceeds it) and
  // mode-scoped (in "queue" mode every row is unreviewed by construction, so
  // a client-side count would always show 0 Confirmed/False positives here
  // regardless of the real numbers). Preview mode has no diagnostics payload,
  // so it falls back to counting the fixture data directly.
  const unreviewed = !isPreview && diagnostics ? diagnostics.unreviewed_count : activeAlerts.filter((a) => a.validationStatus === "unreviewed").length;
  const confirmed = !isPreview && diagnostics ? diagnostics.confirmed_count : activeAlerts.filter((a) => a.validationStatus === "confirmed").length;
  const falsePositives = !isPreview && diagnostics ? diagnostics.false_positive_count : activeAlerts.filter((a) => a.validationStatus === "false_positive").length;
  const routesAffected = !isPreview && diagnostics ? diagnostics.routes_affected_count : new Set(activeAlerts.map((a) => a.route)).size;
  const spareCandidates = activeAlerts.filter((a) => a.sourceSystem === "spare").length;
  // Only a required feed can undermine the no-show inference this module draws
  // from absence - a supporting retrospective feed (Avail Missed Trips) being
  // behind reduces context without invalidating a live candidate, so it must
  // not raise a warning that tells staff to distrust the queue.
  const blockingFeeds = (diagnostics?.feed_health ?? []).filter(
    (feed) => feed.required && feed.status !== "current",
  );

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
  const detailPane = selected ? (
    <MissedTripDetail
      key={selected.id}
      alert={selected}
      routesById={routesById}
      reasonCodes={reasonCodes}
      reasonDraft={reasonDraft}
      onReasonChange={setReasonDraft}
      notesDraft={notesDraft}
      onNotesChange={setNotesDraft}
      validating={validating}
      validateError={validateError}
      reviews={reviews}
      onValidate={(status) => void validate(selected, status)}
    />
  ) : (
    <aside className="risk-detail missed-trip-detail risk-empty-state" aria-label="No trip selected">
      <strong>No trip selected</strong>
      <span>No candidate matches the current filters. Clear a filter or pick a trip from the list.</span>
    </aside>
  );
  const pageSizeControl = (
    <label className="risk-page-size">
      <span>Show</span>
      <select
        className="f"
        value={displayPageSize}
        onChange={(event) => setDisplayPageSize(Number(event.target.value))}
        aria-label="Trips displayed per page"
      >
        {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size} trips</option>)}
      </select>
    </label>
  );
  const paginationControls = filteredAlerts.length > 0 ? (
    <nav className="risk-pagination" aria-label="Missed trips pages">
      <button
        className="btn-sm"
        disabled={effectiveDisplayPage === 0}
        onClick={() => setDisplayPage((current) => Math.max(0, current - 1))}
      >
        Previous
      </button>
      <span>Page {effectiveDisplayPage + 1} of {displayPageCount}</span>
      <button
        className="btn-sm"
        disabled={effectiveDisplayPage >= displayPageCount - 1}
        onClick={() => setDisplayPage((current) => Math.min(displayPageCount - 1, current + 1))}
      >
        Next
      </button>
    </nav>
  ) : null;
  const sourceFilterControl = (
    <select
      className="f"
      value={sourceFilter}
      onChange={(event) => setSourceFilter(event.target.value as "all" | "spare" | "gtfs")}
      aria-label="Filter by data source"
    >
      <option value="all">All sources</option>
      <option value="spare">Spare</option>
      <option value="gtfs">GTFS-Realtime</option>
    </select>
  );

  return (
    <>
      <div className="concept-banner">
        <span className="concept-badge">
          {dataMode === "loading"
            ? "Loading"
            : isPreview
              ? "Development preview"
              : dataMode === "error"
                ? "Data unavailable"
                : configured
                  ? diagnostics?.schedule_detection_status === "paused" ? "Cancellation-only" : "Live data"
                  : "Partial data"}
        </span>
        <span>
          {liveMessage ?? `Authenticated missed-trip data loaded${diagnostics?.last_checked_at ? ` · last detector check ${agoLabel(minutesAgo(diagnostics.last_checked_at))}` : ""}.${
            dataMode === "live" && diagnostics?.spare_enabled
              ? ` ${spareCandidates} Spare candidate${spareCandidates === 1 ? "" : "s"} in this ${mode === "queue" ? "view" : "history"}.`
              : ""
          }`}
        </span>
      </div>
      {blockingFeeds.length > 0 ? (
        <div className="concept-banner" role="status">
          <span className="concept-badge">Feed warning</span>
          <span>
            {blockingFeeds.map((feed) => feed.status === "stale" && feed.stale_after_minutes !== null
              ? `${feed.feed_name} (beyond its ${feed.stale_after_minutes}-minute contract)`
              : `${feed.feed_name} (no usable ingestion recorded)`).join(", ")}
            {blockingFeeds.length === 1 ? " is" : " are"} outside the freshness contract for missed-trip detection. Absence must not be treated as a no-show.
          </span>
        </div>
      ) : null}
      {dataMode === "live" && !diagnostics?.spare_enabled ? (
        // Only the disabled state earns a banner of its own: it means on-demand
        // trips are absent from this queue entirely, which changes what the
        // counts mean. An enabled feed's candidate count is a fact about the
        // current filter, so it rides along with the data line above instead of
        // holding a row of its own.
        <div className="concept-banner" aria-label="Spare feed status">
          <span className="concept-badge">Spare feed disabled</span>
          <span>On-demand trips are not included in this {mode === "queue" ? "view" : "history"}.</span>
        </div>
      ) : null}

      <div className="risk-stat-grid" aria-label="Missed trip review summary">
        <RiskStat value={unreviewed} label="Unreviewed" tone="warning" />
        <RiskStat value={confirmed} label="Confirmed" tone="danger" />
        <RiskStat value={falsePositives} label="False positives" tone="muted" />
        <RiskStat value={routesAffected} label="Routes affected" tone="accent" />
      </div>

      {/* Excluded, not hidden: staff should know the queue is deliberately
          narrower than the table, and why reviewing those rows is not the
          remedy for them. */}
      {mode === "queue" && !isPreview && (diagnostics?.legacy_unverified_count ?? 0) > 0 ? (
        <p className="empty-note" style={{ padding: "0 4px 10px" }}>
          {diagnostics!.legacy_unverified_count.toLocaleString()} legacy candidates from the superseded
          detector are excluded from this queue. Their outcome is unknown rather than false — the evidence
          needed to decide them was never recorded — so they are retained for audit instead of reviewed.
        </p>
      ) : null}

      {dataMode === "loading" ? (
        <div className="risk-empty-state"><strong>Loading missed trips…</strong></div>
      ) : dataMode === "error" ? (
        <div className="risk-empty-state">
          <strong>Missed-trip data is unavailable</strong>
          <span>{liveMessage}</span>
          <button className="btn-sm" onClick={load}>Try again</button>
        </div>
      ) : activeAlerts.length === 0 ? (
        <div className="risk-empty-state">
          <strong>{mode === "queue" ? "Review queue is clear" : "No reviewed history"}</strong>
          <span>{mode === "queue" ? "No unreviewed missed-trip candidates are currently waiting." : "Reviewed and resolved trips will appear here."}</span>
        </div>
      ) : layout === "table" ? (
        <div className="risk-workspace risk-workspace-table">
        <section className="risk-list-panel missed-trips-table-panel" aria-label="Missed trips">
          <div className="risk-section-head">
            <div>
              <span className="risk-eyebrow">{mode === "queue" ? "Needs investigation" : "Review history"}</span>
              <h3>{mode === "queue" ? "Candidate trips" : "Reviewed and resolved trips"}</h3>
            </div>
            <div className="risk-section-head-actions">
              <span className="risk-count">{displayStart}–{displayEnd} of {filteredAlerts.length} trips</span>
              {layoutToggle}
            </div>
          </div>

          <div className="risk-list-toolbar">
            {sourceFilterControl}
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
            {sourceFilter !== "all" || routeFilter || dateFilter ? (
              <button className="btn-sm" onClick={() => { setSourceFilter("all"); setRouteFilter(""); setDateFilter(""); }}>
                Clear filters
              </button>
            ) : null}
            {pageSizeControl}
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
                  visibleAlerts.map((alert) => {
                    const age = agingBadge(alert);
                    const goToDetail = () => {
                      setSelectedId(alert.id);
                    };
                    return (
                      <tr
                        key={alert.id}
                        className={`missed-trip-row ${alert.id === selected?.id ? "selected" : ""}`}
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
                        <td>{routeLabel(alert.route, routesById, alert.sourceSystem)}</td>
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
                          {age ? <div style={{ marginTop: 4 }}><span className={`pill-sm ${age.className}`}>{age.label}</span></div> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {paginationControls}
        </section>
        {detailPane}
        </div>
      ) : (
        <div className="risk-workspace">
          <section className="risk-list-panel" aria-label="Missed trips">
            <div className="risk-section-head">
              <div>
                <span className="risk-eyebrow">{mode === "queue" ? "Needs investigation" : "Review history"}</span>
                <h3>{mode === "queue" ? "Candidate trips" : "Reviewed and resolved trips"}</h3>
              </div>
              <div className="risk-section-head-actions">
                <span className="risk-count">{displayStart}–{displayEnd} of {filteredAlerts.length} trips</span>
                {layoutToggle}
              </div>
            </div>

            <div className="risk-list-toolbar">
              {sourceFilterControl}
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
              {sourceFilter !== "all" || routeFilter || dateFilter ? (
                <button className="btn-sm" onClick={() => { setSourceFilter("all"); setRouteFilter(""); setDateFilter(""); }}>
                  Clear filters
                </button>
              ) : null}
              {pageSizeControl}
            </div>

            <div className="risk-list-head" aria-hidden="true">
              <span>Service</span>
              <span>Detection</span>
              <span>Review</span>
            </div>

            {filteredAlerts.length === 0 ? (
              <div className="empty-note" style={{ padding: "16px 4px" }}>No trips match these filters.</div>
            ) : null}

            {visibleAlerts.map((alert) => {
              const active = alert.id === selected?.id;
              const age = agingBadge(alert);
              return (
                <button
                  className={`risk-list-row ${active ? "selected" : ""}`}
                  key={alert.id}
                  onClick={() => setSelectedId(alert.id)}
                  aria-pressed={active}
                >
                  <span className="risk-service">
                    <strong>{routeLabel(alert.route, routesById, alert.sourceSystem)}</strong>
                    <small>{sourceLabel(alert.sourceSystem)} · scheduled {timeLabel(alert.scheduledDepartureAt)}</small>
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
                    {age ? <small><span className={`pill-sm ${age.className}`}>{age.label}</span></small> : null}
                  </span>
                </button>
              );
            })}
            {paginationControls}
          </section>

          {detailPane}
        </div>
      )}
      {dataMode === "live" && diagnostics && diagnostics.returned_count < diagnostics.view_count ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
          <button className="btn-sm" onClick={() => setPageLimit((current) => Math.min(2000, current + 200))}>
            Load more ({diagnostics.returned_count} of {diagnostics.view_count})
          </button>
        </div>
      ) : null}
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
  reviews,
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
  reviews: MissedTripReview[];
  onValidate: (status: "confirmed" | "false_positive") => void;
}) {
  const reviewed = alert.validationStatus !== "unreviewed";

  return (
    <aside className="risk-detail missed-trip-detail" aria-label={`${routeLabel(alert.route, routesById, alert.sourceSystem)} missed trip detail`}>
      <div className="risk-detail-head">
        <div>
          <span className="risk-eyebrow">Selected trip</span>
          <h3>{alert.sourceSystem === "spare" ? "Request" : "Trip"} {tripCode(alert.scheduledDepartureAt, alert.direction)} · {routeLabel(alert.route, routesById, alert.sourceSystem)}</h3>
          <p>
            Service date {formatServiceDate(alert.serviceDate)} · <span className="mono-ref">Ref {alert.tripId}</span>
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
        <div><dt>Source</dt><dd>{alert.sourceSystem === "spare" ? "Spare Requests + Slots" : "GTFS / GTFS-RT"}</dd></div>
        <div><dt>Detection status</dt><dd>{statusLabel(alert.status, alert.validationStatus)}</dd></div>
        <div><dt>Detection type</dt><dd>{detectionTypeLabel(alert.detectionType)}</dd></div>
        <div><dt>Evidence quality</dt><dd>{dataQualityLabel(alert.dataQualityStatus)}</dd></div>
        <div><dt>Detector version</dt><dd>{alert.detectorVersion ?? "Legacy — not recorded"}</dd></div>
        <div><dt>First flagged</dt><dd>{timeLabel(alert.firstSeenWatchingAt)}</dd></div>
        <div>
          <dt>{alert.sourceSystem === "spare" ? "Pickup arrival evidence" : "First underway evidence"}</dt>
          <dd>{alert.detectedLateArrivalAt ? timeLabel(alert.detectedLateArrivalAt) : "Not observed"}</dd>
        </div>
      </dl>

      {alert.sourceSystem === "spare" ? (
        <div className="risk-detail-section">
          <h4>Spare evidence</h4>
          <dl className="risk-facts">
            <div><dt>Late start</dt><dd>{alert.conditionLateStart ? "Triggered" : "No"}</dd></div>
            <div><dt>Same-duty supersession</dt><dd>{alert.conditionSuperseded ? "Triggered" : "No"}</dd></div>
            <div><dt>Late arrival</dt><dd>{alert.conditionLateArrival ? "Triggered" : "No"}</dd></div>
            <div><dt>Pickup lateness</dt><dd>{alert.startDelaySeconds === null ? "—" : `${Math.round(alert.startDelaySeconds / 60)} min`}</dd></div>
            <div><dt>Dropoff lateness</dt><dd>{alert.arrivalDelaySeconds === null ? "—" : `${Math.round(alert.arrivalDelaySeconds / 60)} min`}</dd></div>
          </dl>
        </div>
      ) : null}

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
        {!reasonDraft ? <p className="risk-unknown">A reason is required for either review outcome.</p> : null}

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
          <button className="btn-primary" disabled={validating || !reasonDraft} onClick={() => onValidate("confirmed")}>
            {validating ? "Saving…" : "Confirm missed trip"}
          </button>
          <button className="btn-sm" disabled={validating || !reasonDraft} onClick={() => onValidate("false_positive")}>
            Mark false positive
          </button>
        </div>
      </div>

      {reviews.length > 0 ? (
        <div className="risk-detail-section">
          <h4>Review history</h4>
          {reviews.map((review) => (
            <p className="risk-unknown" key={review.review_id}>
              <strong>{validationLabel(review.validation_status)}</strong> · {review.reason_code} · {review.reviewed_by}
              {review.reviewed_at ? ` at ${timeLabel(review.reviewed_at)}` : ""}
              {review.notes ? <><br />{review.notes}</> : null}
            </p>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

interface MonthlyRow {
  service_month: string;
  route_id: string;
  source_system: "gtfs" | "spare";
  cancellations: number;
  noShows: number;
  spareCandidates: number;
  confirmed: number;
  falsePositive: number;
  unreviewed: number;
  total: number;
}

function pivotMonthlySummary(summary: MissedTripsMonthlySummaryRow[]): MonthlyRow[] {
  const byKey = new Map<string, MonthlyRow>();
  for (const r of summary) {
    const key = `${r.service_month}-${r.source_system}-${r.route_id}`;
    const row = byKey.get(key) ?? {
      service_month: r.service_month,
      route_id: r.route_id,
      source_system: r.source_system,
      cancellations: 0,
      noShows: 0,
      spareCandidates: 0,
      confirmed: 0,
      falsePositive: 0,
      unreviewed: 0,
      total: 0,
    };
    if (r.detection_type === "explicit_cancellation") row.cancellations += r.trip_count;
    if (r.detection_type === "silent_no_show") row.noShows += r.trip_count;
    if (r.detection_type?.startsWith("spare_")) row.spareCandidates += r.trip_count;
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
      <p className="empty-note" style={{ padding: "12px 16px 0" }}>
        Source-verified rows only. Confirmed is the compliance count; unreviewed rows remain candidates and false positives are shown for detector QA.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Month</th>
            <th>Route</th>
            <th>Cancellations</th>
            <th>No-shows</th>
            <th>Spare candidates</th>
            <th>Confirmed</th>
            <th>False positives</th>
            <th>Unreviewed</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.service_month}-${r.source_system}-${r.route_id}`}>
              <td>{formatServiceMonth(r.service_month)}</td>
              <td>{routeLabel(r.route_id, routesById, r.source_system)}</td>
              <td>{r.cancellations}</td>
              <td>{r.noShows}</td>
              <td>{r.spareCandidates}</td>
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
