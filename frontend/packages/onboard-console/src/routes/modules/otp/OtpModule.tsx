import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  type FlaggedStop,
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
import { currentServiceMonth, formatServiceMonth, fromMonthInputValue, toMonthInputValue } from "./otpServiceMonth.js";
import { useOtpReview } from "./useOtpReview.js";
import { DATA, PAGE_META } from "./otpData.js";
import { displayRoutes, previewRoutes, type OtpDisplayRoute } from "./otpFigures.js";
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
  // Recording or approving a weather day also belongs in the timeline.
  const [weatherActionTick, setWeatherActionTick] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dateExclusions, setDateExclusions] = useState<OtpDateExclusion[]>([]);
  const [stopReasonCodes, setStopReasonCodes] = useState<OtpReasonCode[]>([]);
  const [dateReasonCodes, setDateReasonCodes] = useState<OtpReasonCode[]>([]);

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


  // record_count is the server's count of stop/day rows for the month. It used
  // to be `stops.length`, back when the whole table was shipped here so the
  // browser could work out its own Review Queue (ADR 0034).
  const usingLiveOtp = Boolean(liveOtp?.diagnostics.table_ready && liveOtp.diagnostics.record_count > 0);
  const serviceMonth = liveOtp?.diagnostics.service_month ?? null;

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
  const flaggedStops: FlaggedStop[] = useMemo(
    () => (usingLiveOtp ? liveOtp!.flagged ?? [] : []),
    [usingLiveOtp, liveOtp],
  );


  // Every decision the Review Queue makes, and the fetches behind them.
  const review = useOtpReview({ serviceMonth, flaggedStops, reasonCodes: stopReasonCodes });

  // The month's figures. Re-read when the picker moves, when a weather day is
  // approved, and when the Review Queue records a decision - approving used to
  // leave Route Summary showing the figure from before it. Declared after the
  // hook because its dependency list reads what the hook returns.
  useEffect(() => {
    let cancelled = false;
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
  }, [selectedMonth, measurementTick, review.decisionsVersion]);
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
    setWeatherActionTick((t) => t + 1);
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
    setWeatherActionTick((t) => t + 1);
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
      {review.actionError ? <p className="error-text">{review.actionError}</p> : null}

      {page === "dashboard" && (
        <DashboardPage
          displayRows={displayRows}
          statuses={review.statuses}
          weatherCount={dateExclusions.length}
          measurement={measurement}
          targetPct={targetPct}
        />
      )}
      {page === "queue" && (
        <ReviewQueuePage
          flaggedStops={flaggedStops}
          queueRows={review.queueRows}
          statusOf={review.statusOf}
          reasonOf={review.reasonOf}
          reasonCodes={stopReasonCodes}
          onResolve={review.resolve}
          onReason={review.setReason}
          serviceMonth={serviceMonth}
          auditRefreshTick={review.auditRefreshTick + weatherActionTick}
          previousDecisionFor={review.previousDecisionFor}
          onCopy={review.copyFromPrevious}
          onCopyAll={review.copyAllFromPrevious}
          copyingAll={review.copyingAll}
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
