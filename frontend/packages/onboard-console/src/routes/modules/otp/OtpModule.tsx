import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type FlaggedStop,
  type OtpStopExclusion,
  type OtpDateExclusion,
  type DateExclusionSnapshot,
  type OtpReasonCode,
} from "@mvta/shared";
import { api } from "../../../config.js";
import type { OtpMonthlyResponse } from "./otpResponse.js";
import { DashboardPage } from "./OtpDashboard.js";
import { ReviewQueuePage } from "./OtpReviewQueue.js";
import { RouteSummaryPage } from "./OtpRouteSummary.js";
import { WeatherPage } from "./OtpWeather.js";
import { MonthlyAssessmentsPage } from "./OtpMonthlyAssessments.js";
import { AuditStreamPage } from "./OtpAuditStream.js";
import { currentServiceMonth, formatServiceMonth, fromMonthInputValue, toMonthInputValue, previousServiceMonth } from "./otpServiceMonth.js";
import {
  DATA,
  stopExclusionKey,
  PAGE_META,
  type StopExclusionStatus,
} from "./otpData.js";
import { displayRoutes, previewRoutes, queueRow, type OtpDisplayRoute, type QueueRow } from "./otpFigures.js";
import "./otp.css";

const NAV: { page: string; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "queue", label: "Review Queue" },
  { page: "routes", label: "Route Summary" },
  { page: "weather", label: "Weather Exclusions" },
  { page: "monthly", label: "Monthly Assessments" },
  { page: "audit", label: "Audit Stream" },
];

// OTP Compliance — the module's state and the page it is showing. Each of the
// six pages lives in its own file beside this one and is handed what it needs;
// this file owns the service month, the fetches and the review decisions.
//
// Renders as a section of the Compliance tab: no shell of its own, reuses the
// console's shared classes throughout. Route Summary / Review Queue / Dashboard's below-target stat pull
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
