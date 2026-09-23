import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type FlaggedStop,
  type OtpMonthlyRouteRollup,
  type OtpStopExclusion,
  type OtpDateExclusion,
  type DateExclusionSnapshot,
  type OtpReasonCode,
  type OtpAuditEntry,
  type OtpMonthlyTrendPoint,
  type OtpMonthMeasurement,
  type OtpTargetSource,
  type PeriodKpiAssessment,
} from "@mvta/shared";
import { api } from "../../../config.js";
import {
  DATA,
  stopExclusionKey,
  PAGE_META,
  type StopExclusionStatus,
} from "./otpData.js";
import { displayRoutes, percentText, previewRoutes, queueRow, targetSentence, weatherSentence, type OtpDisplayRoute, type QueueRow } from "./otpFigures.js";
import { auditLines } from "./otpAuditEntries.js";
import "./otp.css";

interface OtpMonthlyResponse {
  routes: OtpMonthlyRouteRollup[];
  /** Absent on a server older than 1.5.242; the console then shows the preview. */
  measurement?: OtpMonthMeasurement;
  /** Absent on a server older than 1.5.288; the queue is then empty, not wrong. */
  flagged?: FlaggedStop[];
  diagnostics: {
    configured: boolean;
    table_ready: boolean;
    service_month: string;
    record_count: number;
    routes_below_target: number;
    target: number;
    target_source?: OtpTargetSource;
    weather_days_recorded?: number;
  };
}

// Client-side mirror of otpMonthlyFeed.ts's serviceMonthOf - only used to
// seed the month picker's default value before any fetch completes.
function currentServiceMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// <input type="month"> uses "YYYY-MM"; the API/DB use "YYYYMM" throughout
// this module - converters kept local since nothing else needs them.
function toMonthInputValue(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}
function fromMonthInputValue(value: string): string {
  return value.replace("-", "");
}

// "YYYYMM" -> the prior month's "YYYYMM". Used by Review Queue's "copy last
// month's decisions" (Option A of plans/otp-exclusion-carryover-
// enhancement-scope.md) - deliberately still writes a fresh, real,
// dated row for the current month via the normal PUT, not a silent
// carry-forward, so every month keeps its own real reviewed_by/reviewed_at.
function previousServiceMonth(yyyymm: string): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10); // 1-indexed
  const d = new Date(Date.UTC(year, month - 1 - 1, 1)); // -1 for prior month, -1 for 0-indexed Date
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Display-only - "YYYYMM" -> "MM/YYYY" (e.g. "202608" -> "08/2026"), for
// anywhere a resolved service month is shown as text rather than in the
// <input type="month"> picker itself.
function formatServiceMonth(yyyymm: string): string {
  return `${yyyymm.slice(4, 6)}/${yyyymm.slice(0, 4)}`;
}

const NAV: { page: string; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "queue", label: "Review Queue" },
  { page: "routes", label: "Route Summary" },
  { page: "weather", label: "Weather Exclusions" },
  { page: "monthly", label: "Monthly Assessments" },
  { page: "audit", label: "Audit Stream" },
];

// OTP Compliance — ported from otp_app.html. Renders as a section of the
// Compliance tab: no shell of its own, reuses the console's shared classes
// throughout. Route Summary / Review Queue / Dashboard's below-target stat pull
// from Avail's real OTP Monthly feed (otpMonthlyFeedPoll.ts) once it's
// configured and has data for the current month; Monthly Assessments also
// surfaces the real Missed Trips feed (availMissedTripsPoll.ts). Both fall
// back to this file's sample routes when the live feed isn't configured yet
// or has no rows, so the module is never broken for a signed-in reviewer
// before the feeds are live. The Review Queue has no sample rows: a queue of
// invented stops could be actioned to no effect.
//
// Review Queue approvals/rejections and weather exclusions are now
// PERSISTED (OtpStopExclusions/OtpDateExclusions) when using live data -
// they used to be ephemeral browser state that reset on reload. Reason
// codes are admin-editable/persisted too (OtpReasonCodes); this module READS
// them and no longer edits them - that moved to the Administration
// workspace's OTP Compliance page (OtpComplianceAdmin.tsx). The early/late
// bias threshold is not read here at all any more: the server applies it and
// returns the month's Flagged Stops (ADR 0034).
export function OtpModule() {
  const [page, setPage] = useState("queue");

  // Which service month the whole module is viewing - defaults to the
  // current month but staff can switch to any past month. Everything below
  // (Route Summary, Review Queue, Monthly Assessments, Audit Stream's
  // "current month" scope) reads off this one selection rather than each
  // page silently defaulting to "whatever the server picks," so a month
  // with real Avail data can actually be viewed instead of always landing
  // on a brand-new month before Avail has aggregated anything for it.
  const [selectedMonth, setSelectedMonth] = useState<string>(currentServiceMonth());

  const [liveOtp, setLiveOtp] = useState<OtpMonthlyResponse | null>(null);
  // Approving anything moves the official figure, so the measurement has to be
  // read again. It did not used to be: approving a stop exclusion updated the
  // decision list and left Route Summary showing the figure from before it,
  // until the month was switched or the page reloaded.
  const [measurementTick, setMeasurementTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stopExclusions, setStopExclusions] = useState<OtpStopExclusion[]>([]);
  const [dateExclusions, setDateExclusions] = useState<OtpDateExclusion[]>([]);
  const [stopReasonCodes, setStopReasonCodes] = useState<OtpReasonCode[]>([]);
  const [dateReasonCodes, setDateReasonCodes] = useState<OtpReasonCode[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Month-independent - fetched once, not tied to selectedMonth. Each call
  // gets its OWN catch rather than one shared Promise.all - a Promise.all
  // rejects (and discards every already-succeeded result) the moment ANY
  // one of its promises rejects, so one flaky call used to blank out every
  // state here, including reason codes that had actually loaded fine -
  // the likely cause of an "empty" reason-code dropdown that had nothing
  // to do with reason codes themselves.
  useEffect(() => {
    let cancelled = false;
    api
      .getDateExclusions()
      .then((dates) => !cancelled && setDateExclusions(dates.exclusions))
      .catch(() => {
        /* graceful - Weather page just shows nothing logged yet */
      });
    api
      .getReasonCodes("stop", true)
      .then((stopCodes) => !cancelled && setStopReasonCodes(stopCodes.reason_codes))
      .catch(() => {
        /* graceful - Review Queue's dropdown falls back to free entry */
      });
    api
      .getReasonCodes("date", true)
      .then((dateCodes) => !cancelled && setDateReasonCodes(dateCodes.reason_codes))
      .catch(() => {
        /* graceful - Weather page's dropdown falls back to free entry */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Month-dependent - refetches whenever the picker changes. Also clears
  // actionError - it used to persist across a month switch (nothing reset
  // it), so a failed approve/reject on one month kept showing as a
  // seemingly-unrelated error banner after switching to a different month
  // entirely.
  useEffect(() => {
    let cancelled = false;
    setActionError(null);
    api
      .getOtpMonthly(selectedMonth)
      .then((otp) => {
        if (cancelled) return;
        setLiveOtp(otp);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLiveOtp(null);
        setLoadError(
          err instanceof ApiError
            ? `Could not load live OTP compliance data: ${err.message}`
            : "Could not reach the OTP compliance service.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, measurementTick]);

  // record_count is the server's count of stop/day rows for the month. It used
  // to be `stops.length`, back when the whole table was shipped here so the
  // browser could work out its own Review Queue (ADR 0034).
  const usingLiveOtp = Boolean(liveOtp?.diagnostics.table_ready && liveOtp.diagnostics.record_count > 0);
  const serviceMonth = liveOtp?.diagnostics.service_month ?? null;

  useEffect(() => {
    if (!usingLiveOtp || !serviceMonth) return;
    api
      .getStopExclusions(serviceMonth)
      .then((d) => setStopExclusions(d.exclusions))
      .catch(() => {
        /* graceful - Review Queue simply shows everything as pending */
      });
  }, [usingLiveOtp, serviceMonth]);

  // Previous month's decisions, for Review Queue's "copy last month" -
  // Option A of plans/otp-exclusion-carryover-enhancement-scope.md. Read
  // only; copying still goes through the normal PUT so this month gets
  // its own real row.
  const [previousMonthExclusions, setPreviousMonthExclusions] = useState<OtpStopExclusion[]>([]);
  useEffect(() => {
    if (!usingLiveOtp || !serviceMonth) {
      setPreviousMonthExclusions([]);
      return;
    }
    api
      .getStopExclusions(previousServiceMonth(serviceMonth))
      .then((d) => setPreviousMonthExclusions(d.exclusions))
      .catch(() => setPreviousMonthExclusions([]));
  }, [usingLiveOtp, serviceMonth]);

  const previousExclusionByKey = useMemo(() => {
    const map = new Map<string, OtpStopExclusion>();
    for (const ex of previousMonthExclusions) {
      map.set(stopExclusionKey(ex.route_id, ex.stop_id, ex.day_of_week), ex);
    }
    return map;
  }, [previousMonthExclusions]);

  // The official figure per route is the server's (ADR 0033); the preview's
  // sample data has no exclusions behind it and says so.
  const targetPct = (usingLiveOtp ? liveOtp!.diagnostics.target : 0.85) * 100;
  // A tab opened before this release reaches a server that sends no
  // measurement; it then shows the preview rather than half a figure.
  const measurement = usingLiveOtp ? liveOtp!.measurement ?? null : null;
  const displayRows: OtpDisplayRoute[] = useMemo(
    () => (measurement ? displayRoutes(measurement) : previewRoutes(DATA.routes, 85)),
    [measurement],
  );
  // The month's Flagged Stops, as the server decided them and in the order it
  // put them (ADR 0034). The browser used to derive this list itself.
  const flaggedStops: FlaggedStop[] = usingLiveOtp ? liveOtp!.flagged ?? [] : [];
  const queueRows: QueueRow[] = useMemo(() => flaggedStops.map(queueRow), [flaggedStops]);

  const exclusionByKey = useMemo(() => {
    const map = new Map<string, OtpStopExclusion>();
    for (const ex of stopExclusions) {
      map.set(stopExclusionKey(ex.route_id, ex.stop_id, ex.day_of_week), ex);
    }
    return map;
  }, [stopExclusions]);

  const [draftReason, setDraftReason] = useState<Record<string, string>>({});

  const keyOf = (stop: FlaggedStop): string =>
    stopExclusionKey(stop.route_id, stop.stop_id, stop.day_of_week);

  function statusOf(stop: FlaggedStop): StopExclusionStatus {
    return exclusionByKey.get(keyOf(stop))?.status ?? "pending";
  }

  function reasonOf(stop: FlaggedStop): string {
    const persisted = exclusionByKey.get(keyOf(stop))?.reason_code;
    return draftReason[keyOf(stop)] ?? persisted ?? stopReasonCodes[0]?.code ?? "";
  }

  const statuses = flaggedStops.map(statusOf);

  const [auditRefreshTick, setAuditRefreshTick] = useState(0);

  // Every review decision takes the same shape: write the row, re-read the
  // month, refresh the timeline. One place to get that sequence right - it
  // used to be spelled out separately in each of the three below.
  async function record(
    stop: FlaggedStop,
    decision: { status: "approved" | "rejected"; reason_code: string | null },
    failure: string,
  ): Promise<boolean> {
    if (!serviceMonth) return false;
    try {
      await api.putStopExclusion({
        service_month: serviceMonth,
        route_id: stop.route_id,
        stop_id: stop.stop_id,
        day_of_week: stop.day_of_week,
        ...decision,
      });
      return true;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : failure);
      return false;
    }
  }

  async function refreshDecisions() {
    if (!serviceMonth) return;
    const refreshed = await api.getStopExclusions(serviceMonth);
    setStopExclusions(refreshed.exclusions);
    setAuditRefreshTick((t) => t + 1);
    setMeasurementTick((t) => t + 1);
  }

  async function resolve(stop: FlaggedStop, action: "approve" | "reject") {
    setActionError(null);
    const reason = reasonOf(stop);
    const saved = await record(
      stop,
      { status: action === "approve" ? "approved" : "rejected", reason_code: reason || null },
      "Could not save this review decision.",
    );
    if (saved) await refreshDecisions();
  }

  // "Copy last month's decisions" - Option A of
  // plans/otp-exclusion-carryover-enhancement-scope.md. Deliberately still
  // writes a fresh, real, dated row for THIS month via the normal PUT -
  // not a silent carry-forward. A human still takes an explicit action
  // (the copy click itself) for every month; it's just one click applying
  // last month's answer instead of re-deriving it from scratch.
  function previousDecisionFor(stop: FlaggedStop): OtpStopExclusion | undefined {
    return previousExclusionByKey.get(keyOf(stop));
  }

  async function copyFromPrevious(stop: FlaggedStop) {
    const prev = previousDecisionFor(stop);
    if (!prev) return;
    setActionError(null);
    const saved = await record(
      stop,
      { status: prev.status, reason_code: prev.reason_code },
      "Could not copy last month's decision.",
    );
    if (saved) await refreshDecisions();
  }

  const [copyingAll, setCopyingAll] = useState(false);

  // Bulk version - one explicit click, still N real per-stop PUTs (one dated
  // row per stop, same as clicking each one individually) rather than a
  // single "carry forward" record, so the audit trail stays identical in
  // shape to doing this one stop at a time.
  async function copyAllFromPrevious() {
    setActionError(null);
    setCopyingAll(true);
    try {
      const targets = flaggedStops
        .map((stop) => ({ stop, prev: previousDecisionFor(stop) }))
        .filter(({ stop, prev }) => prev && statusOf(stop) === "pending");

      for (const { stop, prev } of targets) {
        if (!prev) continue;
        const saved = await record(
          stop,
          { status: prev.status, reason_code: prev.reason_code },
          "Could not copy all of last month's decisions.",
        );
        if (!saved) break;
      }
      await refreshDecisions();
    } finally {
      setCopyingAll(false);
    }
  }

  function setReason(stop: FlaggedStop, reason: string) {
    setDraftReason((d) => ({ ...d, [keyOf(stop)]: reason }));
  }

  async function addDateExclusion(input: {
    scope: "Agency" | "Route";
    route_id: number | null;
    service_date: string;
    reason_code: string;
    notes: string;
  }) {
    await api.createDateExclusion({
      scope: input.scope,
      route_id: input.route_id,
      service_date: input.service_date,
      reason_code: input.reason_code,
      notes: input.notes || null,
    });
    const refreshed = await api.getDateExclusions();
    setDateExclusions(refreshed.exclusions);
    setAuditRefreshTick((t) => t + 1);
  }

  /**
   * Approve a weather day. The server freezes what the date took out and the
   * month subtracts it (ADR 0038), so the measurement is read again rather
   * than left showing the figure from before the approval.
   *
   * A refusal carries the server's own reason - the daily feed has nothing for
   * that date, or the month has no rows for its day of week - and it is shown
   * as it came, because "could not approve" would leave the reviewer with no
   * idea whether to retry, pick another date, or give up.
   */
  async function approveDateExclusion(id: string): Promise<DateExclusionSnapshot> {
    const result = await api.approveDateExclusion(id);
    const refreshed = await api.getDateExclusions();
    setDateExclusions(refreshed.exclusions);
    setAuditRefreshTick((t) => t + 1);
    setMeasurementTick((t) => t + 1);
    return result.snapshot;
  }

  const meta = PAGE_META[page];

  return (
    <div className="otp-panel">
      <div className="occ-switch small">
        {NAV.map((n) => (
          <button
            key={n.page}
            className={page === n.page ? "active" : ""}
            onClick={() => setPage(n.page)}
          >
            {n.label}
          </button>
        ))}
      </div>

      <p className="panel-desc" style={{ marginBottom: 10 }}>
        <b>{meta.title}.</b> {meta.sub}
      </p>

      <div className="concept-banner" style={{ flexWrap: "wrap", gap: 10 }}>
        <span className="concept-badge">{usingLiveOtp ? "Live data" : "Preview data"}</span>
        <span>
          {usingLiveOtp
            ? `Avail OTP Monthly feed - ${formatServiceMonth(liveOtp!.diagnostics.service_month)}, ${liveOtp!.diagnostics.record_count} stop/day rows.`
            : loadError ?? `Avail OTP Monthly feed has no rows for ${selectedMonth} yet - showing sample data.`}
        </span>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Service month
          <input
            className="f"
            type="month"
            style={{ width: 150 }}
            value={toMonthInputValue(selectedMonth)}
            max={toMonthInputValue(currentServiceMonth())}
            onChange={(e) => e.target.value && setSelectedMonth(fromMonthInputValue(e.target.value))}
          />
        </label>
      </div>
      {actionError ? <p className="error-text">{actionError}</p> : null}

      {page === "dashboard" && (
        <DashboardPage
          displayRows={displayRows}
          statuses={statuses}
          weatherCount={dateExclusions.length}
          measurement={measurement}
          targetPct={targetPct}
        />
      )}
      {page === "queue" && (
        <ReviewQueuePage
          flaggedStops={flaggedStops}
          queueRows={queueRows}
          statusOf={statusOf}
          reasonOf={reasonOf}
          reasonCodes={stopReasonCodes}
          onResolve={resolve}
          onReason={setReason}
          serviceMonth={serviceMonth}
          auditRefreshTick={auditRefreshTick}
          previousDecisionFor={previousDecisionFor}
          onCopy={copyFromPrevious}
          onCopyAll={copyAllFromPrevious}
          copyingAll={copyingAll}
        />
      )}
      {page === "routes" && (
        <RouteSummaryPage displayRows={displayRows} targetPct={targetPct} measurement={measurement} />
      )}
      {page === "weather" && (
        <WeatherPage
          dateExclusions={dateExclusions}
          reasonCodes={dateReasonCodes}
          onAdd={addDateExclusion}
          onApprove={approveDateExclusion}
          recordedThisMonth={liveOtp?.diagnostics.weather_days_recorded ?? 0}
          appliedThisMonth={liveOtp?.measurement?.weather_days_applied ?? 0}
        />
      )}
      {page === "monthly" && <MonthlyAssessmentsPage otp={liveOtp} displayRows={displayRows} targetPct={targetPct} />}
      {page === "audit" && <AuditStreamPage serviceMonth={serviceMonth} reasonCodes={stopReasonCodes} />}
    </div>
  );
}

function DashboardPage({
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

function AdherenceStrip({ row }: { row: QueueRow }) {
  const other = Math.max(0, 100 - row.earlyPct - row.ontimePct - row.latePct - row.missedPct);
  const segs = [
    { cls: "early", v: row.earlyPct },
    { cls: "ontime", v: row.ontimePct },
    { cls: "late", v: row.latePct },
    { cls: "missed", v: row.missedPct + other },
  ];
  return (
    <div className="adherence-strip">
      {segs.map((s, i) => <div key={i} className={`seg ${s.cls}`} style={{ width: `${s.v}%` }} />)}
    </div>
  );
}

function ReviewQueuePage({
  flaggedStops,
  queueRows,
  statusOf,
  reasonOf,
  reasonCodes,
  onResolve,
  onReason,
  serviceMonth,
  auditRefreshTick,
  previousDecisionFor,
  onCopy,
  onCopyAll,
  copyingAll,
}: {
  flaggedStops: FlaggedStop[];
  queueRows: QueueRow[];
  statusOf: (stop: FlaggedStop) => StopExclusionStatus;
  reasonOf: (stop: FlaggedStop) => string;
  reasonCodes: OtpReasonCode[];
  onResolve: (stop: FlaggedStop, action: "approve" | "reject") => void;
  onReason: (stop: FlaggedStop, reason: string) => void;
  serviceMonth: string | null;
  auditRefreshTick: number;
  previousDecisionFor: (stop: FlaggedStop) => OtpStopExclusion | undefined;
  onCopy: (stop: FlaggedStop) => void;
  onCopyAll: () => void;
  copyingAll: boolean;
}) {
  const [routeFilter, setRouteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const routes = useMemo(() => [...new Set(queueRows.map((r) => r.routeLabel))].sort(), [queueRows]);

  const [timeline, setTimeline] = useState<OtpAuditEntry[]>([]);
  const timelineLines = useMemo(() => auditLines(timeline, reasonCodes), [timeline, reasonCodes]);
  useEffect(() => {
    api
      .getOtpAuditStream(serviceMonth ?? undefined, 6)
      .then((d) => setTimeline(d.entries))
      .catch(() => setTimeline([]));
  }, [serviceMonth, auditRefreshTick]);

  const reasonLabel = (code: string) => reasonCodes.find((r) => r.code === code)?.label ?? code;

  const copyableCount = flaggedStops.filter(
    (stop) => statusOf(stop) === "pending" && previousDecisionFor(stop),
  ).length;

  return (
    <div className="otp-two">
      <div className="subcard otp-queue">
        <div className="otp-queue-toolbar">
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
            <option value="">All routes</option>
            {routes.map((r) => <option key={r} value={r}>Route {r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Pending review</option>
            <option value="all">All flagged stops</option>
            <option value="resolved">Resolved only</option>
          </select>
          <input placeholder="Search stop name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {copyableCount > 0 ? (
          <div className="subcard otp-copy-banner" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <span>
              {copyableCount} pending stop{copyableCount === 1 ? "" : "s"} matched last month's decision.
            </span>
            <button className="btn-post" disabled={copyingAll} onClick={onCopyAll}>
              {copyingAll ? "Copying…" : `Copy all ${copyableCount} matching last month's decisions`}
            </button>
          </div>
        ) : null}

        {queueRows.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            {serviceMonth
              ? "No stops show an early/late-bias pattern above the review threshold this month."
              : "The Avail OTP Monthly feed has no rows for this month yet, so there is nothing to review."}
          </div>
        ) : null}

        {queueRows.map((row, i) => {
          const stop = flaggedStops[i]!;
          const status = statusOf(stop);
          const reason = reasonOf(stop);
          if (routeFilter && row.routeLabel !== routeFilter) return null;
          if (statusFilter === "pending" && status !== "pending") return null;
          if (statusFilter === "resolved" && status === "pending") return null;
          if (search && !row.stopName.toLowerCase().includes(search.toLowerCase())) return null;

          const iconClass = status === "approved" ? "ok" : status === "rejected" ? "rejected" : "warn";
          const iconGlyph = status === "approved" ? "\u2713" : status === "rejected" ? "\u2715" : "!";
          const prevDecision = status === "pending" ? previousDecisionFor(stop) : undefined;

          return (
            <div className={`check-row${status === "pending" ? " highlight" : ""}`} key={row.key}>
              <div className={`status-icon ${iconClass}`}>{iconGlyph}</div>
              <div className="check-body">
                <div className="check-title"><span className="route-chip">RT {row.routeLabel}</span>{row.stopName}</div>
                <div className="check-desc">Stop {row.stopId} · {row.dayOfWeek} · {row.sampled} departures sampled · {row.biasLabel}</div>
                <AdherenceStrip row={row} />
                {prevDecision ? (
                  <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                    Last month: {prevDecision.status === "approved" ? "Approved" : "Rejected"}
                    {prevDecision.reason_code ? ` \u2014 ${reasonLabel(prevDecision.reason_code)}` : ""}
                  </div>
                ) : null}
              </div>
              <div className="check-actions">
                {status === "pending" ? (
                  <>
                    <select value={reason} onChange={(e) => onReason(stop, e.target.value)}>
                      {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    <button className="btn-post" onClick={() => onResolve(stop, "approve")}>Approve</button>
                    <button className="btn-sm" onClick={() => onResolve(stop, "reject")}>Reject</button>
                    {prevDecision ? (
                      <button className="btn-sm" onClick={() => onCopy(stop)}>Copy last month</button>
                    ) : null}
                  </>
                ) : status === "approved" ? (
                  <span className="ok-text">Excluded — {reasonLabel(reason)}</span>
                ) : (
                  <span className="muted">Kept in OTP calc</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="subcard otp-timeline">
        <h2>Review Timeline</h2>
        {timelineLines.length === 0 ? <p className="muted">No review activity yet.</p> : null}
        {timelineLines.map((t, i) => (
          <div className="timeline-item" key={i}>
            <div className="t-title">{t.title}</div>
            <div className="t-desc">{t.detail}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}

function RouteSummaryPage({
  displayRows,
  targetPct,
  measurement,
}: {
  displayRows: OtpDisplayRoute[];
  targetPct: number;
  measurement: OtpMonthMeasurement | null;
}) {
  const target = `${Math.round(targetPct * 10) / 10}%`;
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
      <div className="subcard" style={{ overflow: "hidden" }}>
        <table className="data">
          <thead>
            <tr><th>Route</th><th>Departure events</th><th>Raw OTP %</th><th>Official OTP %</th><th>Δ from exclusions</th><th>Status vs. {target}</th></tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.key}>
                <td><span className="route-chip">RT {r.label}</span></td>
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

function WeatherPage({
  dateExclusions,
  reasonCodes,
  onAdd,
  onApprove,
  recordedThisMonth,
  appliedThisMonth,
}: {
  dateExclusions: OtpDateExclusion[];
  reasonCodes: OtpReasonCode[];
  onAdd: (input: { scope: "Agency" | "Route"; route_id: number | null; service_date: string; reason_code: string; notes: string }) => Promise<void>;
  onApprove: (id: string) => Promise<DateExclusionSnapshot>;
  recordedThisMonth: number;
  appliedThisMonth: number;
}) {
  const [scope, setScope] = useState<"Agency" | "Route">("Agency");
  const [routeIdInput, setRouteIdInput] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(reasonCodes[0]?.code ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!date) { setError("Enter a service date."); return; }
    const routeId = scope === "Route" ? parseInt(routeIdInput, 10) : null;
    if (scope === "Route" && !Number.isInteger(routeId)) { setError("Enter a numeric route ID for a route-specific exclusion."); return; }
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        scope,
        route_id: routeId,
        service_date: date.replace(/-/g, ""),
        reason_code: reason || reasonCodes[0]?.code || "OTHER",
        notes: notes.trim(),
      });
      setRouteIdInput("");
      setNotes("");
      setDate("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this exclusion.");
    } finally {
      setSaving(false);
    }
  }

  // Keyed by exclusion, not held as one banner: a refusal belongs against the
  // date it refused, and approving a second date must not clear the first
  // one's explanation.
  const [approving, setApproving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowResult, setRowResult] = useState<Record<string, string>>({});

  async function approve(exclusion: OtpDateExclusion) {
    setApproving(exclusion.id);
    setRowError((e) => ({ ...e, [exclusion.id]: "" }));
    try {
      const snapshot = await onApprove(exclusion.id);
      const stops = snapshot.stops === 1 ? "1 stop" : `${snapshot.stops} stops`;
      setRowResult((r) => ({
        ...r,
        [exclusion.id]: `Removed ${snapshot.departures.toLocaleString()} departures across ${stops} (${snapshot.day_of_week}).`,
      }));
    } catch (err) {
      // The server's own reason, as it came. It says which of the three things
      // was missing and what to do instead; "could not approve" would not.
      setRowError((e) => ({
        ...e,
        [exclusion.id]: err instanceof ApiError ? err.message : "Could not approve this date.",
      }));
    } finally {
      setApproving(null);
    }
  }

  const sorted = [...dateExclusions].sort((a, b) => b.service_date.localeCompare(a.service_date));

  return (
    <>
      <div className="subcard empty-note" style={{ marginBottom: 16 }}>
        {weatherSentence(recordedThisMonth, appliedThisMonth)}
      </div>
      <div className="subcard" style={{ marginBottom: 16 }}>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="field-grid">
          <div>
            <p className="field-label">Scope</p>
            <select className="f" value={scope} onChange={(e) => setScope(e.target.value as "Agency" | "Route")}>
              <option value="Agency">All routes (agency-wide)</option>
              <option value="Route">Specific route</option>
            </select>
          </div>
          {scope === "Route" && (
            <div>
              <p className="field-label">Route ID</p>
              <input className="f" value={routeIdInput} onChange={(e) => setRouteIdInput(e.target.value)} placeholder="e.g. 490" />
            </div>
          )}
          <div>
            <p className="field-label">Service date</p>
            <input className="f" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <p className="field-label">Reason</p>
            <select className="f" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field-grid single">
          <div>
            <p className="field-label">Notes</p>
            <input className="f" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Metro-wide snow emergency" />
          </div>
        </div>
        <button className="btn-post" disabled={saving} onClick={add}>{saving ? "Saving…" : "Add exclusion"}</button>
      </div>
      <div className="subcard" style={{ overflow: "hidden" }}>
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Scope</th><th>Reason</th><th>Status</th><th>Removed from OTP</th><th>Contractor notified</th></tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.id}>
                <td>{d.service_date}</td>
                <td>{d.scope === "Agency" ? "All routes" : `Route ${d.route_id}`}</td>
                <td>
                  {reasonCodes.find((r) => r.code === d.reason_code)?.label ?? d.reason_code}
                  {d.notes ? <div className="td-dim" style={{ marginTop: 2 }}>{d.notes}</div> : null}
                </td>
                <td>
                  {d.status === "Approved" ? (
                    <>
                      <span className="pill-sm pill-success">Approved</span>
                      {d.approved_by ? (
                        <div className="td-dim" style={{ marginTop: 2 }}>
                          {d.approved_by}{d.approved_at ? ` · ${d.approved_at.slice(0, 10)}` : ""}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="pill-sm pill-warning">Proposed</span>
                      <div style={{ marginTop: 4 }}>
                        <button
                          className="btn-post btn-sm"
                          disabled={approving !== null}
                          onClick={() => approve(d)}
                        >
                          {approving === d.id ? "Approving…" : "Approve"}
                        </button>
                      </div>
                    </>
                  )}
                  {rowError[d.id] ? (
                    <div className="error-text" style={{ marginTop: 4, fontSize: "0.85em" }} role="alert">{rowError[d.id]}</div>
                  ) : null}
                  {rowResult[d.id] ? (
                    <div className="ok-text" style={{ marginTop: 4, fontSize: "0.85em" }}>{rowResult[d.id]}</div>
                  ) : null}
                </td>
                <td>
                  {d.status !== "Approved" ? (
                    <span className="muted">—</span>
                  ) : d.excluded_departures ? (
                    <b>{d.excluded_departures.toLocaleString()}</b>
                  ) : (
                    // Approved with nothing frozen behind it: only possible for
                    // a date approved before the snapshot existed.
                    <span className="muted">Nothing recorded</span>
                  )}
                </td>
                <td>
                  {!d.notified ? (
                    <span className="pill-sm pill-muted">Not yet notified</span>
                  ) : d.acknowledged ? (
                    <span className="pill-sm pill-success">Acknowledged {d.notified_at?.slice(0, 10)}</span>
                  ) : (
                    <span className="pill-sm pill-accent">Notified {d.notified_at?.slice(0, 10)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Real "locked OTP snapshot for contractor assessment" page - OTP % per
// route (Avail OTP Monthly) only, per Ty's direction (2026-08-06). Used to
// also show Avail Missed Trips incident counts here, but that's been
// removed - NOTE this is NOT the same data as the standalone "Missed
// Trips" Compliance tab (MissedTripAlerts.tsx, GTFS-RT-based real-time
// no-show/cancellation detection - a different data source entirely).
// Removing this section means GET /avail-missed-trips currently has no UI
// consumer anywhere in the app - the feed/poller/table still exist and
// keep collecting data, just nothing renders it right now.
function MonthlyAssessmentsPage({
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
function AuditStreamPage({ serviceMonth, reasonCodes }: { serviceMonth: string | null; reasonCodes: OtpReasonCode[] }) {
  const [entries, setEntries] = useState<OtpAuditEntry[] | null>(null);
  const [scopeToMonth, setScopeToMonth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOtpAuditStream(scopeToMonth ? serviceMonth ?? undefined : undefined, 100)
      .then((d) => {
        setEntries(d.entries);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the audit stream."));
  }, [scopeToMonth, serviceMonth]);

  return (
    <div className="subcard">
      <div className="otp-queue-toolbar" style={{ marginBottom: 12 }}>
        <label>
          <input type="checkbox" checked={scopeToMonth} onChange={(e) => setScopeToMonth(e.target.checked)} disabled={!serviceMonth} />
          {" "}Current month only{serviceMonth ? ` (${formatServiceMonth(serviceMonth)})` : ""}
        </label>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {entries === null && !error ? <p className="muted">Loading…</p> : null}
      {entries && entries.length === 0 ? <p className="empty-note">No exclusion actions recorded yet.</p> : null}
      {auditLines(entries ?? [], reasonCodes).map((t, i) => (
        <div className="timeline-item" key={i}>
          <div className="t-title">{t.title}</div>
          <div className="t-desc">{t.detail}</div>
          <div className="td-dim" style={{ fontSize: 11 }}>{new Date(t.at).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
