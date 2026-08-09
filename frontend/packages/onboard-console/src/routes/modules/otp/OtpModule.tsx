import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type OtpMonthlyStopRow,
  type OtpMonthlyRouteRollup,
  type OtpStopExclusion,
  type OtpDateExclusion,
  type OtpReasonCode,
  type OtpAuditEntry,
  type OtpMonthlyTrendPoint,
  type OtpHistoricalBackfillResponse,
} from "@mvta/shared";
import { api } from "../../../config.js";
import {
  DATA,
  computeOfficialPct,
  deriveCandidatesFromLive,
  deriveRouteRowsFromLive,
  stopExclusionKey,
  DEFAULT_EARLY_LATE_BIAS_THRESHOLD,
  PAGE_META,
  type Candidate,
  type RouteRow,
  type CandidateStatus,
} from "./otpData.js";
import "./otp.css";

interface OtpMonthlyResponse {
  stops: OtpMonthlyStopRow[];
  routes: OtpMonthlyRouteRollup[];
  diagnostics: {
    configured: boolean;
    table_ready: boolean;
    service_month: string;
    record_count: number;
    routes_below_target: number;
    target: number;
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
  { page: "admin", label: "Administration" },
  { page: "tuner", label: "Threshold Tuner" },
];

// OTP Compliance — ported from otp_app.html. Renders as a section of the
// Compliance tab: no shell of its own, reuses the console's shared classes
// throughout. Route Summary / Review Queue / Dashboard's below-target stat pull
// from Avail's real OTP Monthly feed (otpMonthlyFeedPoll.ts) once it's
// configured and has data for the current month; Monthly Assessments also
// surfaces the real Missed Trips feed (availMissedTripsPoll.ts). Both fall
// back to this file's mock DATA/candidates when the live feed isn't
// configured yet or has no rows, so the module is never broken for a
// signed-in reviewer before the feeds are live.
//
// Review Queue approvals/rejections and weather exclusions are now
// PERSISTED (OtpStopExclusions/OtpDateExclusions) when using live data -
// they used to be ephemeral browser state that reset on reload. Reason
// codes and the early/late bias detection threshold are now admin-editable/
// persisted too (OtpReasonCodes/OtpSettings), replacing what used to be
// hardcoded arrays/constants. See detour-and-event-module-implementation-
// plan.md's sibling OTP-completion plan for the full design. Mock-preview
// mode (feed not configured/no rows) keeps its old ephemeral behavior -
// there's nothing real to persist in that state.
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const [threshold, setThreshold] = useState<number>(DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  const [stopExclusions, setStopExclusions] = useState<OtpStopExclusion[]>([]);
  const [dateExclusions, setDateExclusions] = useState<OtpDateExclusion[]>([]);
  const [stopReasonCodes, setStopReasonCodes] = useState<OtpReasonCode[]>([]);
  const [dateReasonCodes, setDateReasonCodes] = useState<OtpReasonCode[]>([]);
  // Missed Trips' investigation-outcome dropdown reuses this same table
  // (migration-023's applies_to='missed_trip') rather than a separate one -
  // managed here alongside the other two for one consistent Admin CRUD
  // surface, even though Missed Trips itself is a different console module.
  const [missedTripReasonCodes, setMissedTripReasonCodes] = useState<OtpReasonCode[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Month-independent - fetched once, not tied to selectedMonth. Each call
  // gets its OWN catch rather than one shared Promise.all - a Promise.all
  // rejects (and discards every already-succeeded result) the moment ANY
  // one of its promises rejects, so one flaky call used to blank out all
  // four states, including reason codes that had actually loaded fine -
  // the likely cause of an "empty" reason-code dropdown that had nothing
  // to do with reason codes themselves.
  useEffect(() => {
    let cancelled = false;
    api
      .getOtpSettings()
      .then((settings) => !cancelled && setThreshold(settings.early_late_bias_threshold))
      .catch(() => {
        /* graceful - Threshold Tuner/Administration show the default */
      });
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
    api
      .getReasonCodes("missed_trip", true)
      .then((codes) => !cancelled && setMissedTripReasonCodes(codes.reason_codes))
      .catch(() => {
        /* graceful - Administration just shows an empty table */
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
  }, [selectedMonth]);

  const usingLiveOtp = Boolean(liveOtp?.diagnostics.table_ready && liveOtp.stops.length > 0);
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

  const routeRows: RouteRow[] = useMemo(
    () => (usingLiveOtp ? deriveRouteRowsFromLive(liveOtp!.routes) : DATA.routes),
    [usingLiveOtp, liveOtp],
  );
  const candidateSource: Candidate[] = useMemo(
    () => (usingLiveOtp ? deriveCandidatesFromLive(liveOtp!.stops, threshold) : DATA.candidates),
    [usingLiveOtp, liveOtp, threshold],
  );

  const exclusionByKey = useMemo(() => {
    const map = new Map<string, OtpStopExclusion>();
    for (const ex of stopExclusions) {
      map.set(stopExclusionKey(ex.route_id, ex.stop_id, ex.day_of_week), ex);
    }
    return map;
  }, [stopExclusions]);

  // Mock-mode-only ephemeral fallback (nothing real to persist in preview).
  const [mockStates, setMockStates] = useState<{ status: CandidateStatus; reason: string }[]>(
    DATA.candidates.map(() => ({ status: "pending", reason: "" })),
  );
  const [draftReason, setDraftReason] = useState<Record<string, string>>({});

  function candidateKey(c: Candidate, i: number): string {
    return usingLiveOtp ? stopExclusionKey(c.route_id, c.stopId, c.day_of_week) : `mock-${i}`;
  }

  function candidateStatus(c: Candidate, i: number): CandidateStatus {
    if (usingLiveOtp) {
      return exclusionByKey.get(candidateKey(c, i))?.status ?? "pending";
    }
    return mockStates[i]?.status ?? "pending";
  }

  function candidateReason(c: Candidate, i: number): string {
    const persisted = usingLiveOtp ? exclusionByKey.get(candidateKey(c, i))?.reason_code : mockStates[i]?.reason;
    return draftReason[candidateKey(c, i)] ?? persisted ?? stopReasonCodes[0]?.code ?? "";
  }

  const statuses = candidateSource.map((c, i) => candidateStatus(c, i));

  const [auditRefreshTick, setAuditRefreshTick] = useState(0);

  async function resolve(i: number, action: "approve" | "reject") {
    const c = candidateSource[i];
    const reason = candidateReason(c, i);
    setActionError(null);

    if (usingLiveOtp && serviceMonth && c.route_id !== null && c.day_of_week !== null) {
      try {
        await api.putStopExclusion({
          service_month: serviceMonth,
          route_id: c.route_id,
          stop_id: c.stopId,
          day_of_week: c.day_of_week,
          status: action === "approve" ? "approved" : "rejected",
          reason_code: reason || null,
        });
        const refreshed = await api.getStopExclusions(serviceMonth);
        setStopExclusions(refreshed.exclusions);
        setAuditRefreshTick((t) => t + 1);
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : "Could not save this review decision.");
      }
    } else {
      setMockStates((cs) => {
        const next = cs.slice();
        next[i] = { status: action === "approve" ? "approved" : "rejected", reason };
        return next;
      });
    }
  }

  // "Copy last month's decisions" - Option A of
  // plans/otp-exclusion-carryover-enhancement-scope.md. Deliberately still
  // writes a fresh, real, dated row for THIS month via the normal PUT -
  // not a silent carry-forward. A human still takes an explicit action
  // (the copy click itself) for every month; it's just one click applying
  // last month's answer instead of re-deriving it from scratch.
  function previousDecisionFor(c: Candidate): OtpStopExclusion | undefined {
    if (!usingLiveOtp || c.route_id === null || c.day_of_week === null) return undefined;
    return previousExclusionByKey.get(stopExclusionKey(c.route_id, c.stopId, c.day_of_week));
  }

  async function copyFromPrevious(i: number) {
    const c = candidateSource[i];
    const prev = previousDecisionFor(c);
    if (!prev || !serviceMonth || c.route_id === null || c.day_of_week === null) return;
    setActionError(null);
    try {
      await api.putStopExclusion({
        service_month: serviceMonth,
        route_id: c.route_id,
        stop_id: c.stopId,
        day_of_week: c.day_of_week,
        status: prev.status,
        reason_code: prev.reason_code,
      });
      const refreshed = await api.getStopExclusions(serviceMonth);
      setStopExclusions(refreshed.exclusions);
      setAuditRefreshTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not copy last month's decision.");
    }
  }

  const [copyingAll, setCopyingAll] = useState(false);

  // Bulk version - one explicit click, still N real per-candidate PUTs (one
  // dated row per stop, same as clicking each one individually) rather than
  // a single "carry forward" record, so the audit trail stays identical in
  // shape to doing this one candidate at a time.
  async function copyAllFromPrevious() {
    if (!serviceMonth) return;
    setActionError(null);
    setCopyingAll(true);
    try {
      const targets = candidateSource
        .map((c, i) => ({ c, i, prev: previousDecisionFor(c) }))
        .filter(({ c, i, prev }) => prev && candidateStatus(c, i) === "pending");

      for (const { c, prev } of targets) {
        if (!prev || c.route_id === null || c.day_of_week === null) continue;
        await api.putStopExclusion({
          service_month: serviceMonth,
          route_id: c.route_id,
          stop_id: c.stopId,
          day_of_week: c.day_of_week,
          status: prev.status,
          reason_code: prev.reason_code,
        });
      }
      const refreshed = await api.getStopExclusions(serviceMonth);
      setStopExclusions(refreshed.exclusions);
      setAuditRefreshTick((t) => t + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not copy all of last month's decisions.");
    } finally {
      setCopyingAll(false);
    }
  }

  function setReason(c: Candidate, i: number, reason: string) {
    setDraftReason((d) => ({ ...d, [candidateKey(c, i)]: reason }));
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
          routeRows={routeRows}
          candidateSource={candidateSource}
          statuses={statuses}
          weatherCount={dateExclusions.length}
          liveRoutesBelowTarget={usingLiveOtp ? liveOtp!.diagnostics.routes_below_target : null}
          targetPct={(usingLiveOtp ? liveOtp!.diagnostics.target : 0.85) * 100}
        />
      )}
      {page === "queue" && (
        <ReviewQueuePage
          candidateSource={candidateSource}
          statusOf={candidateStatus}
          reasonOf={candidateReason}
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
        <RouteSummaryPage routeRows={routeRows} candidateSource={candidateSource} statuses={statuses} />
      )}
      {page === "weather" && (
        <WeatherPage dateExclusions={dateExclusions} reasonCodes={dateReasonCodes} onAdd={addDateExclusion} />
      )}
      {page === "monthly" && <MonthlyAssessmentsPage otp={liveOtp} />}
      {page === "audit" && <AuditStreamPage serviceMonth={serviceMonth} />}
      {page === "admin" && (
        <AdministrationPage
          stopReasonCodes={stopReasonCodes}
          dateReasonCodes={dateReasonCodes}
          missedTripReasonCodes={missedTripReasonCodes}
          threshold={threshold}
          onReasonCodesChanged={() => {
            api.getReasonCodes("stop", true).then((d) => setStopReasonCodes(d.reason_codes));
            api.getReasonCodes("date", true).then((d) => setDateReasonCodes(d.reason_codes));
            api.getReasonCodes("missed_trip", true).then((d) => setMissedTripReasonCodes(d.reason_codes));
          }}
        />
      )}
      {page === "tuner" && (
        <ThresholdTunerPage
          liveStops={usingLiveOtp ? liveOtp!.stops : null}
          currentThreshold={threshold}
          onApplied={(newThreshold) => setThreshold(newThreshold)}
        />
      )}
    </div>
  );
}

function DashboardPage({
  routeRows,
  candidateSource,
  statuses,
  weatherCount,
  liveRoutesBelowTarget,
  targetPct,
}: {
  routeRows: RouteRow[];
  candidateSource: Candidate[];
  statuses: CandidateStatus[];
  weatherCount: number;
  liveRoutesBelowTarget: number | null;
  targetPct: number;
}) {
  const approved = statuses.filter((s) => s === "approved").length;
  const rejected = statuses.filter((s) => s === "rejected").length;
  const pending = statuses.length - approved - rejected;
  const below =
    liveRoutesBelowTarget ?? routeRows.filter((r) => computeOfficialPct(r, candidateSource, statuses) < targetPct).length;
  const cards = [
    { label: "Pending review", value: pending, sub: "Candidate stops", color: "#F78E1E" },
    { label: "Approved", value: approved, sub: "Active exclusion rules", color: "#00553D" },
    { label: `Routes below ${targetPct}%`, value: below, sub: "Official departure OTP", color: "#8A1F1F" },
    { label: "Weather exclusions", value: weatherCount, sub: "Logged this year", color: "#417B68" },
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
        Percent only - no penalty-dollar figure is shown until a real Attachment G penalty rate is
        available.
      </p>
    </div>
  );
}

function AdherenceStrip({ c }: { c: Candidate }) {
  const other = Math.max(0, 100 - c.early_pct - c.ontime_pct - c.late_pct - c.missed_pct);
  const segs = [
    { cls: "early", v: c.early_pct },
    { cls: "ontime", v: c.ontime_pct },
    { cls: "late", v: c.late_pct },
    { cls: "missed", v: c.missed_pct + other },
  ];
  return (
    <div className="adherence-strip">
      {segs.map((s, i) => <div key={i} className={`seg ${s.cls}`} style={{ width: `${s.v}%` }} />)}
    </div>
  );
}

function ReviewQueuePage({
  candidateSource,
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
  candidateSource: Candidate[];
  statusOf: (c: Candidate, i: number) => CandidateStatus;
  reasonOf: (c: Candidate, i: number) => string;
  reasonCodes: OtpReasonCode[];
  onResolve: (i: number, action: "approve" | "reject") => void;
  onReason: (c: Candidate, i: number, reason: string) => void;
  serviceMonth: string | null;
  auditRefreshTick: number;
  previousDecisionFor: (c: Candidate) => OtpStopExclusion | undefined;
  onCopy: (i: number) => void;
  onCopyAll: () => void;
  copyingAll: boolean;
}) {
  const [routeFilter, setRouteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const routes = useMemo(() => [...new Set(candidateSource.map((c) => c.route))].sort(), [candidateSource]);

  const [timeline, setTimeline] = useState<OtpAuditEntry[]>([]);
  useEffect(() => {
    api
      .getOtpAuditStream(serviceMonth ?? undefined, 6)
      .then((d) => setTimeline(d.entries))
      .catch(() => setTimeline([]));
  }, [serviceMonth, auditRefreshTick]);

  const reasonLabel = (code: string) => reasonCodes.find((r) => r.code === code)?.label ?? code;

  const copyableCount = candidateSource.filter(
    (c, i) => statusOf(c, i) === "pending" && previousDecisionFor(c),
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
            <option value="all">All candidates</option>
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

        {candidateSource.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            No stops currently show an early/late-bias pattern above the review threshold.
          </div>
        ) : null}

        {candidateSource.map((c, i) => {
          const status = statusOf(c, i);
          const reason = reasonOf(c, i);
          if (routeFilter && c.route !== routeFilter) return null;
          if (statusFilter === "pending" && status !== "pending") return null;
          if (statusFilter === "resolved" && status === "pending") return null;
          if (search && !c.stopName.toLowerCase().includes(search.toLowerCase())) return null;

          const varLabel =
            c.avg_var !== null
              ? c.avg_var < 0
                ? `${Math.abs(c.avg_var)}s early (avg)`
                : `${c.avg_var}s late (avg, mixed pattern)`
              : c.early_pct > c.late_pct
                ? "Early-biased"
                : "Late-biased";
          const iconClass = status === "approved" ? "ok" : status === "rejected" ? "rejected" : "warn";
          const iconGlyph = status === "approved" ? "✓" : status === "rejected" ? "✕" : "!";
          const prevDecision = status === "pending" ? previousDecisionFor(c) : undefined;

          return (
            <div className={`check-row${status === "pending" ? " highlight" : ""}`} key={`${c.route}-${c.stopId}-${i}`}>
              <div className={`status-icon ${iconClass}`}>{iconGlyph}</div>
              <div className="check-body">
                <div className="check-title"><span className="route-chip">RT {c.route}</span>{c.stopName}</div>
                <div className="check-desc">Stop {c.stopId} · {c.direction || "—"} · {c.n} trips sampled · {varLabel}</div>
                <AdherenceStrip c={c} />
                {prevDecision ? (
                  <div className="muted" style={{ fontSize: "0.85em", marginTop: 4 }}>
                    Last month: {prevDecision.status === "approved" ? "Approved" : "Rejected"}
                    {prevDecision.reason_code ? ` — ${reasonLabel(prevDecision.reason_code)}` : ""}
                  </div>
                ) : null}
              </div>
              <div className="check-actions">
                {status === "pending" ? (
                  <>
                    <select value={reason} onChange={(e) => onReason(c, i, e.target.value)}>
                      {reasonCodes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                    </select>
                    <button className="btn-post" onClick={() => onResolve(i, "approve")}>Approve</button>
                    <button className="btn-sm" onClick={() => onResolve(i, "reject")}>Reject</button>
                    {prevDecision ? (
                      <button className="btn-sm" onClick={() => onCopy(i)}>Copy last month</button>
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
        {timeline.length === 0 ? <p className="muted">No review activity yet.</p> : null}
        {timeline.map((t, i) => (
          <div className="timeline-item" key={i}>
            <div className="t-title">{t.title}</div>
            <div className="t-desc">{t.desc}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}

function RouteSummaryPage({
  routeRows,
  candidateSource,
  statuses,
}: {
  routeRows: RouteRow[];
  candidateSource: Candidate[];
  statuses: CandidateStatus[];
}) {
  return (
    <div className="subcard" style={{ overflow: "hidden" }}>
      <table className="data">
        <thead>
          <tr><th>Route</th><th>Departure events</th><th>Raw OTP %</th><th>Official OTP %</th><th>Δ from exclusions</th><th>Status vs. 85%</th></tr>
        </thead>
        <tbody>
          {routeRows.map((r) => {
            const official = computeOfficialPct(r, candidateSource, statuses);
            const delta = Math.round((official - r.pct_raw) * 10) / 10;
            const below = official < 85;
            return (
              <tr key={r.route}>
                <td><span className="route-chip">RT {r.route}</span></td>
                <td>{r.total}</td>
                <td>{r.pct_raw}%</td>
                <td><b>{official}%</b></td>
                <td className={delta > 0 ? "ok-text" : "muted"}>{delta > 0 ? "+" : ""}{delta} pts</td>
                <td>{below ? <span className="pill-sm pill-danger">Below 85%</span> : <span className="pill-sm pill-success">Meets 85%</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeatherPage({
  dateExclusions,
  reasonCodes,
  onAdd,
}: {
  dateExclusions: OtpDateExclusion[];
  reasonCodes: OtpReasonCode[];
  onAdd: (input: { scope: "Agency" | "Route"; route_id: number | null; service_date: string; reason_code: string; notes: string }) => Promise<void>;
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

  const sorted = [...dateExclusions].sort((a, b) => b.service_date.localeCompare(a.service_date));

  return (
    <>
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
            <tr><th>Date</th><th>Scope</th><th>Reason</th><th>Status</th><th>Contractor notified</th></tr>
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
                <td>{d.status === "Approved" ? <span className="pill-sm pill-success">Approved</span> : <span className="pill-sm pill-warning">Proposed</span>}</td>
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
function MonthlyAssessmentsPage({ otp }: { otp: OtpMonthlyResponse | null }) {
  const otpReady = Boolean(otp?.diagnostics.table_ready && otp.routes.length > 0);
  const serviceMonth = otp?.diagnostics.service_month ?? null;

  return (
    <>
      <div className="subcard empty-note" style={{ marginBottom: 16 }}>
        {serviceMonth ? `Service month: ${formatServiceMonth(serviceMonth)}` : "No finalized months yet."}
      </div>

      <div className="subcard" style={{ overflow: "hidden" }}>
        <h2 style={{ padding: "12px 16px 0" }}>OTP by route (Avail OTP Monthly)</h2>
        {otpReady ? (
          <table className="data">
            <thead>
              <tr><th>Route</th><th>Total departures</th><th>On-time</th><th>OTP %</th><th>Status vs. 85%</th></tr>
            </thead>
            <tbody>
              {otp!.routes.map((r) => {
                const pct = r.pct_ontime !== null ? Math.round(r.pct_ontime * 1000) / 10 : null;
                return (
                  <tr key={r.route_id}>
                    <td><span className="route-chip">RT {r.route_label ?? r.route_id}</span></td>
                    <td>{r.total}</td>
                    <td>{r.ontime}</td>
                    <td>{pct !== null ? `${pct}%` : "—"}</td>
                    <td>
                      {pct !== null ? (
                        pct < 85 ? <span className="pill-sm pill-danger">Below 85%</span> : <span className="pill-sm pill-success">Meets 85%</span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            The OTP Monthly feed (AVAIL_OTP_MONTHLY_URL) has not been configured or has no rows for
            this month yet.
          </div>
        )}
      </div>
    </>
  );
}

// Real Audit Stream - built the same way the console's top-level Audit Log
// is: by querying the exclusion records themselves (GET /otp-audit-stream),
// not a separate generic log table.
function AuditStreamPage({ serviceMonth }: { serviceMonth: string | null }) {
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
      {entries?.map((t, i) => (
        <div className="timeline-item" key={i}>
          <div className="t-title">{t.title}</div>
          <div className="t-desc">{t.desc}</div>
          <div className="td-dim" style={{ fontSize: 11 }}>{new Date(t.timestamp).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

// Reason-code management for both Review Queue (stop) and Weather (date)
// exclusions - full CRUD (add, inline-rename, reorder, deactivate/
// reactivate). OCC.Admin-only server-side; the UI hides the write controls
// for anyone else the same way every other admin surface in this app does.
// No hard delete - deactivating is the app's standing convention for
// retiring a value that older records may still reference (same pattern as
// Detours' soft-delete), so a code used on a past exclusion never goes
// unexplained. sort_order drives dropdown order everywhere this feeds
// (Review Queue, Weather) - the up/down controls swap it with a neighbor.
function AdministrationPage({
  stopReasonCodes,
  dateReasonCodes,
  missedTripReasonCodes,
  threshold,
  onReasonCodesChanged,
}: {
  stopReasonCodes: OtpReasonCode[];
  dateReasonCodes: OtpReasonCode[];
  missedTripReasonCodes: OtpReasonCode[];
  threshold: number;
  onReasonCodesChanged: () => void;
}) {
  return (
    <>
      <ReasonCodeTable
        title="Stop exclusion reason codes"
        hint="Shown in Review Queue's reason dropdown when approving or rejecting a stop."
        appliesTo="stop"
        codes={stopReasonCodes}
        onChanged={onReasonCodesChanged}
      />
      <ReasonCodeTable
        title="Date exclusion reason codes"
        hint="Shown in the Weather page's reason dropdown when logging an agency- or route-wide exclusion."
        appliesTo="date"
        codes={dateReasonCodes}
        onChanged={onReasonCodesChanged}
      />
      <ReasonCodeTable
        title="Missed Trips reason codes"
        hint="Shown in the Missed Trips module's investigation-outcome dropdown, alongside the free-text notes field."
        appliesTo="missed_trip"
        codes={missedTripReasonCodes}
        onChanged={onReasonCodesChanged}
      />

      <div className="subcard empty-note">
        Early/late bias detection threshold: <b>{Math.round(threshold * 1000) / 10}%</b> - change it
        from the Threshold Tuner page, which previews the effect before applying.
      </div>

      <OtpHistoricalBackfillPanel />
    </>
  );
}

// One-time (repeatable) admin action to fill OTP Monthly + Missed Trips
// months OUTSIDE the daily pollers' 3-month trailing window - added per
// Ty's "I should be able to see throughout 2026 and beyond." Future months
// need nothing here; the trailing window already rolls forward on its own.
// This only backfills the historical gap behind it (e.g. Jan-May 2026,
// before this feed's poller existed).
const MAX_BACKFILL_MONTHS_CLIENT = 24; // matches the same cap the backend used to enforce server-side

// Inclusive "YYYYMM" list, chronological - client-side copy of
// otpMonthlyFeed.ts's monthsBetween(), used to drive the per-month request
// loop below rather than sending the whole range in one request (see why
// in otpHistoricalBackfill.ts's header comment - a multi-month range in a
// single request 504'd against the live gateway).
function monthsBetweenClient(fromYyyymm: string, toYyyymm: string): string[] {
  const from = new Date(Date.UTC(Number(fromYyyymm.slice(0, 4)), Number(fromYyyymm.slice(4, 6)) - 1, 1));
  const to = new Date(Date.UTC(Number(toYyyymm.slice(0, 4)), Number(toYyyymm.slice(4, 6)) - 1, 1));
  const months: string[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    months.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

// One-time (repeatable) admin action - loops one POST per month rather than
// sending a whole range in one request. CONFIRMED live 2026-08-06: a
// 5-month range in a single request hit a 504 gateway timeout (Missed
// Trips alone has separately taken 15+ minutes for just 3 months). Looping
// client-side keeps each request bounded and shows real per-month progress
// instead of one opaque spinner that eventually fails with nothing to show.
function OtpHistoricalBackfillPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<(OtpHistoricalBackfillResponse | null)[]>([]);
  const [totalMonths, setTotalMonths] = useState(0);

  async function run() {
    if (!from || !to) {
      setError("Enter both a from and to month.");
      return;
    }
    const months = monthsBetweenClient(fromMonthInputValue(from), fromMonthInputValue(to));
    if (months.length === 0) {
      setError("To must not be earlier than from.");
      return;
    }
    if (months.length > MAX_BACKFILL_MONTHS_CLIENT) {
      setError(`Range spans ${months.length} months, exceeding the ${MAX_BACKFILL_MONTHS_CLIENT}-month cap.`);
      return;
    }
    setRunning(true);
    setError(null);
    setResults([]);
    setTotalMonths(months.length);
    for (const month of months) {
      try {
        const response = await api.runOtpHistoricalBackfill({ month });
        setResults((r) => [...r, response]);
      } catch (err) {
        setResults((r) => [
          ...r,
          {
            service_month: month,
            otp_monthly: { reports_seen: 0, upserted: 0, error: err instanceof ApiError ? err.message : "Request failed" },
            missed_trips: { reports_seen: 0, rows_inserted: 0 },
          },
        ]);
      }
    }
    setRunning(false);
  }

  const totalUpserted = results.reduce((sum, r) => sum + (r?.otp_monthly.upserted ?? 0), 0);
  const totalMissedRows = results.reduce((sum, r) => sum + (r?.missed_trips.rows_inserted ?? 0), 0);
  const errored = results.filter((r) => r?.otp_monthly.error || r?.missed_trips.error);
  const done = !running && results.length > 0;

  return (
    <div className="subcard">
      <h3 style={{ marginTop: 0 }}>Historical data backfill</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        The daily poller only refreshes the current month plus the prior two - months before that
        window (e.g. earlier in the year, before this feed existed) never get fetched on their own.
        Run this once per gap; re-running an already-covered month is harmless. Processes one month
        at a time so a large range can't time out.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          From
          <input className="f" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          To
          <input className="f" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button className="btn-post" disabled={running} onClick={() => void run()}>
          {running ? `Running… (${results.length}/${totalMonths})` : "Run backfill"}
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {results.length > 0 ? (
        <div className={done && errored.length === 0 ? "ok-text" : "empty-note"} style={{ marginTop: 10 }}>
          <p>
            {results.length} of {totalMonths} month{totalMonths === 1 ? "" : "s"} processed
            {done ? "" : "…"}: {totalUpserted} OTP Monthly rows upserted, {totalMissedRows} Missed
            Trips rows reloaded so far.
          </p>
          {errored.length > 0 ? (
            <ul>
              {errored.map((r) => (
                <li key={r!.service_month}>
                  {r!.service_month}: {r!.otp_monthly.error ? `OTP Monthly - ${r!.otp_monthly.error}` : ""}
                  {r!.otp_monthly.error && r!.missed_trips.error ? "; " : ""}
                  {r!.missed_trips.error ? `Missed Trips - ${r!.missed_trips.error}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReasonCodeTable({
  title,
  hint,
  appliesTo,
  codes,
  onChanged,
}: {
  title: string;
  hint: string;
  appliesTo: "stop" | "date" | "missed_trip";
  codes: OtpReasonCode[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [addingNew, setAddingNew] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  function startEdit(c: OtpReasonCode) {
    setEditingId(c.id);
    setEditLabel(c.label);
    setError(null);
  }

  async function saveEdit(c: OtpReasonCode) {
    if (!editLabel.trim()) {
      setError("Label can't be empty.");
      return;
    }
    if (editLabel.trim() === c.label) {
      setEditingId(null);
      return;
    }
    setBusyId(c.id);
    setError(null);
    try {
      await api.updateReasonCode(c.id, { label: editLabel.trim() });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename this reason code.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(c: OtpReasonCode) {
    setBusyId(c.id);
    setError(null);
    try {
      await api.updateReasonCode(c.id, { is_active: !c.is_active });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this reason code.");
    } finally {
      setBusyId(null);
    }
  }

  // Swaps sort_order with the adjacent row (skipping over already-inactive
  // rows has no special handling - reordering works on the list as shown,
  // active or not, since inactive codes still occupy a real position).
  async function move(index: number, direction: -1 | 1) {
    const other = codes[index + direction];
    const current = codes[index];
    if (!other) return;
    setBusyId(current.id);
    setError(null);
    try {
      await Promise.all([
        api.updateReasonCode(current.id, { sort_order: other.sort_order }),
        api.updateReasonCode(other.id, { sort_order: current.sort_order }),
      ]);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reorder these reason codes.");
    } finally {
      setBusyId(null);
    }
  }

  async function addCode() {
    if (!newCode.trim() || !newLabel.trim()) {
      setError("Code and label are required.");
      return;
    }
    setAddBusy(true);
    setError(null);
    try {
      await api.createReasonCode({ code: newCode.trim().toUpperCase(), label: newLabel.trim(), applies_to: appliesTo });
      setNewCode("");
      setNewLabel("");
      setAddingNew(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this reason code.");
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div className="subcard" style={{ marginBottom: 16, overflow: "hidden" }}>
      <h2 style={{ padding: "12px 16px 0" }}>{title}</h2>
      <p className="panel-desc" style={{ padding: "0 16px" }}>{hint}</p>
      {error ? <p className="error-text" style={{ padding: "0 16px" }}>{error}</p> : null}
      <table className="data">
        <thead><tr><th style={{ width: 70 }}>Order</th><th>Code</th><th>Label</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {codes.map((c, i) => (
            <tr key={c.id}>
              <td>
                <button className="btn-sm" disabled={busyId === c.id || i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                <button className="btn-sm" disabled={busyId === c.id || i === codes.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
              </td>
              <td className="td-dim">{c.code}</td>
              <td>
                {editingId === c.id ? (
                  <span style={{ display: "flex", gap: 6 }}>
                    <input
                      className="f"
                      style={{ flex: 1 }}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveEdit(c)}
                      autoFocus
                    />
                    <button className="btn-sm" disabled={busyId === c.id} onClick={() => saveEdit(c)}>Save</button>
                    <button className="btn-sm" disabled={busyId === c.id} onClick={() => setEditingId(null)}>Cancel</button>
                  </span>
                ) : (
                  <span onClick={() => startEdit(c)} style={{ cursor: "pointer" }} title="Click to rename">
                    {c.label}
                  </span>
                )}
              </td>
              <td>{c.is_active ? <span className="pill-sm pill-success">Active</span> : <span className="pill-sm pill-muted">Inactive</span>}</td>
              <td>
                {editingId !== c.id ? (
                  <>
                    <button className="btn-sm" disabled={busyId === c.id} onClick={() => startEdit(c)}>Rename</button>
                    <button className="btn-sm" disabled={busyId === c.id} onClick={() => toggleActive(c)}>
                      {c.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
          {codes.length === 0 ? (
            <tr><td colSpan={5} className="td-dim">No reason codes yet.</td></tr>
          ) : null}
        </tbody>
      </table>
      <div style={{ padding: 12 }}>
        {addingNew ? (
          <div className="field-grid">
            <div>
              <p className="field-label">Code</p>
              <input className="f" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. CONSTRUCTION" autoFocus />
            </div>
            <div>
              <p className="field-label">Label</p>
              <input className="f" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Active construction zone" onKeyDown={(e) => e.key === "Enter" && addCode()} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
              <button className="btn-post" disabled={addBusy} onClick={addCode}>Add</button>
              <button className="btn-sm" disabled={addBusy} onClick={() => { setAddingNew(false); setNewCode(""); setNewLabel(""); }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn-sm" onClick={() => setAddingNew(true)}>+ Add a reason code</button>
        )}
      </div>
    </div>
  );
}

// Preview-then-apply workspace over the already-fetched current month's
// stop rows - no new fetch for the preview itself. Applying persists the
// new threshold (OtpSettings) for every reviewer, not just this session.
function ThresholdTunerPage({
  liveStops,
  currentThreshold,
  onApplied,
}: {
  liveStops: OtpMonthlyStopRow[] | null;
  currentThreshold: number;
  onApplied: (newThreshold: number) => void;
}) {
  const [previewPct, setPreviewPct] = useState(Math.round(currentThreshold * 1000) / 10);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  if (!liveStops) {
    return (
      <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>
        Threshold tuning previews against the current month's live OTP Monthly feed data - not
        available yet in preview mode.
      </div>
    );
  }

  const previewCount = deriveCandidatesFromLive(liveStops, previewPct / 100).length;
  const currentCount = deriveCandidatesFromLive(liveStops, currentThreshold).length;

  async function apply() {
    setApplying(true);
    setError(null);
    setApplied(null);
    try {
      const result = await api.updateOtpSettings(previewPct / 100);
      onApplied(result.early_late_bias_threshold);
      setApplied(`Threshold applied: ${Math.round(result.early_late_bias_threshold * 1000) / 10}%`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply this threshold.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="subcard">
      {error ? <p className="error-text">{error}</p> : null}
      {applied ? <p className="ok-text">{applied}</p> : null}
      <p className="field-label">Preview threshold: {previewPct.toFixed(1)}%</p>
      <input
        type="range"
        min={1}
        max={50}
        step={0.5}
        value={previewPct}
        onChange={(e) => setPreviewPct(Number(e.target.value))}
        style={{ width: "100%", maxWidth: 400 }}
      />
      <div className="stat-grid" style={{ marginTop: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Currently applied ({Math.round(currentThreshold * 1000) / 10}%)</div>
          <div className="stat-value">{currentCount}</div>
          <div className="stat-sub">candidates flagged</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">At preview threshold ({previewPct.toFixed(1)}%)</div>
          <div className="stat-value">{previewCount}</div>
          <div className="stat-sub">candidates flagged</div>
        </div>
      </div>
      <button className="btn-post" style={{ marginTop: 16 }} disabled={applying} onClick={apply}>
        {applying ? "Applying…" : "Apply this threshold"}
      </button>
    </div>
  );
}
