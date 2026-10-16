// The Review Queue's state: the decisions already recorded for a month, last
// month's for comparison, and what happens when a reviewer acts.
//
// This is a hook rather than the pure state module the rest of the console
// uses (tripStartLogState.ts, eventMonitoringState.ts) on purpose. Every bug
// this extraction exists to catch lives in an effect, not in a calculation:
//
//   an error from a failed approve surviving a switch to a different month,
//   where it reads as an unrelated banner on a month nobody touched;
//   a decision written but the month not re-read, leaving Route Summary
//   showing the figure from before it;
//   last month's decisions not cleared when the feed goes away.
//
// A pure module could not have reached any of those - it would have taken the
// testable half and left the bugs where they were, which is exactly what was
// said about otpFigures.ts in the review that led here. The cost is that this
// has to be tested with renderHook rather than by calling a function.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type FlaggedStop, type ReasonCode, type OtpStopExclusion } from "@mvta/shared";
import { api } from "../../../config.js";
import { stopExclusionKey, type StopExclusionStatus } from "./otpData.js";
import { queueRow, type QueueRow } from "./otpFigures.js";
import { previousServiceMonth } from "./otpServiceMonth.js";

export interface OtpReviewInput {
  /** The month being reviewed, or null when no feed month is resolved yet. */
  serviceMonth: string | null;
  /** The month's Flagged Stops, as the server decided them (ADR 0034). */
  flaggedStops: readonly FlaggedStop[];
  /** For defaulting a row's reason when nothing is persisted or drafted. */
  reasonCodes: readonly ReasonCode[];
}

export interface OtpReview {
  queueRows: QueueRow[];
  statuses: StopExclusionStatus[];
  statusOf: (stop: FlaggedStop) => StopExclusionStatus;
  reasonOf: (stop: FlaggedStop) => string;
  setReason: (stop: FlaggedStop, reason: string) => void;
  previousDecisionFor: (stop: FlaggedStop) => OtpStopExclusion | undefined;
  /**
   * Decide one or more stop-days the same way. One row is written per
   * stop-day, in order, and the month is re-read once. True when every row
   * was written; false stops at the first failure and leaves actionError set.
   */
  resolve: (stops: readonly FlaggedStop[], action: "approve" | "reject") => Promise<boolean>;
  copyFromPrevious: (stops: readonly FlaggedStop[]) => Promise<void>;
  copyAllFromPrevious: () => Promise<void>;
  copyingAll: boolean;
  /** How many decisions the month holds, including stops no longer flagged. */
  decidedCount: number;
  /** Clear the month's decisions. True when the reset was written. */
  resetMonth: () => Promise<boolean>;
  resetting: boolean;
  actionError: string | null;
  /** Bumped when the timeline should be re-read. */
  auditRefreshTick: number;
  /**
   * Bumped when a decision has changed what the month scores, so the caller
   * re-reads the measurement. Approving used to update the decision list and
   * leave Route Summary showing the figure from before it.
   */
  decisionsVersion: number;
}

const keyOf = (stop: FlaggedStop): string =>
  stopExclusionKey(stop.route_id, stop.stop_id, stop.day_of_week);

export function useOtpReview({ serviceMonth, flaggedStops, reasonCodes }: OtpReviewInput): OtpReview {
  const [stopExclusions, setStopExclusions] = useState<OtpStopExclusion[]>([]);
  const [previousMonthExclusions, setPreviousMonthExclusions] = useState<OtpStopExclusion[]>([]);
  const [draftReason, setDraftReason] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyingAll, setCopyingAll] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [auditRefreshTick, setAuditRefreshTick] = useState(0);
  const [decisionsVersion, setDecisionsVersion] = useState(0);

  // A month's decisions, and the month before it for "copy last month".
  //
  // Both are cleared when the month changes rather than left showing the
  // previous month's answers until the fetch lands, and so is actionError: a
  // failure on one month used to persist as a banner on another, because
  // nothing reset it.
  useEffect(() => {
    let cancelled = false;
    setActionError(null);
    setDraftReason({});
    if (!serviceMonth) {
      setStopExclusions([]);
      setPreviousMonthExclusions([]);
      return;
    }
    setStopExclusions([]);
    setPreviousMonthExclusions([]);
    api
      .getStopExclusions(serviceMonth)
      .then((d) => !cancelled && setStopExclusions(d.exclusions))
      .catch(() => {
        /* graceful - the queue then shows everything as pending */
      });
    api
      .getStopExclusions(previousServiceMonth(serviceMonth))
      .then((d) => !cancelled && setPreviousMonthExclusions(d.exclusions))
      .catch(() => {
        /* graceful - "copy last month" simply offers nothing */
      });
    return () => {
      cancelled = true;
    };
  }, [serviceMonth]);

  const exclusionByKey = useMemo(() => {
    const map = new Map<string, OtpStopExclusion>();
    for (const ex of stopExclusions) map.set(stopExclusionKey(ex.route_id, ex.stop_id, ex.day_of_week), ex);
    return map;
  }, [stopExclusions]);

  const previousExclusionByKey = useMemo(() => {
    const map = new Map<string, OtpStopExclusion>();
    for (const ex of previousMonthExclusions) map.set(stopExclusionKey(ex.route_id, ex.stop_id, ex.day_of_week), ex);
    return map;
  }, [previousMonthExclusions]);

  const queueRows = useMemo(() => flaggedStops.map(queueRow), [flaggedStops]);

  const statusOf = useCallback(
    (stop: FlaggedStop): StopExclusionStatus => exclusionByKey.get(keyOf(stop))?.status ?? "pending",
    [exclusionByKey],
  );

  const reasonOf = useCallback(
    (stop: FlaggedStop): string => {
      const persisted = exclusionByKey.get(keyOf(stop))?.reason_code;
      return draftReason[keyOf(stop)] ?? persisted ?? reasonCodes[0]?.code ?? "";
    },
    [exclusionByKey, draftReason, reasonCodes],
  );

  const previousDecisionFor = useCallback(
    (stop: FlaggedStop): OtpStopExclusion | undefined => previousExclusionByKey.get(keyOf(stop)),
    [previousExclusionByKey],
  );

  const setReason = useCallback((stop: FlaggedStop, reason: string) => {
    setDraftReason((d) => ({ ...d, [keyOf(stop)]: reason }));
  }, []);

  const statuses = useMemo(() => flaggedStops.map(statusOf), [flaggedStops, statusOf]);

  // Every decision takes the same shape: write the row, re-read the month,
  // refresh the timeline, and tell the caller the figure has moved.
  const record = useCallback(
    async (
      stop: FlaggedStop,
      decision: { status: "approved" | "rejected"; reason_code: string | null },
      failure: string,
    ): Promise<boolean> => {
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
    },
    [serviceMonth],
  );

  const refreshDecisions = useCallback(async () => {
    if (!serviceMonth) return;
    const refreshed = await api.getStopExclusions(serviceMonth);
    setStopExclusions(refreshed.exclusions);
    setAuditRefreshTick((t) => t + 1);
    setDecisionsVersion((v) => v + 1);
  }, [serviceMonth]);

  // A reviewer decides a stop, not a stop-day: "this is a recovery point" is
  // one judgement that covers every weekday the stop was flagged on. The
  // record is still one row per stop-day, written in order so a failure
  // leaves the earlier days decided and the rest pending, which is what the
  // queue then shows. The month is re-read once, not once per day.
  const resolve = useCallback(
    async (stops: readonly FlaggedStop[], action: "approve" | "reject") => {
      setActionError(null);
      let written = 0;
      for (const stop of stops) {
        const saved = await record(
          stop,
          { status: action === "approve" ? "approved" : "rejected", reason_code: reasonOf(stop) || null },
          "Could not save this review decision.",
        );
        if (!saved) break;
        written += 1;
      }
      if (written > 0) await refreshDecisions();
      return written === stops.length;
    },
    [record, reasonOf, refreshDecisions],
  );

  // "Copy last month's decisions". Deliberately still writes a fresh, dated
  // row for THIS month through the normal PUT rather than carrying one
  // forward: a human takes an explicit action for every month, it is just one
  // click applying last month's answer instead of re-deriving it.
  const copyFromPrevious = useCallback(
    async (stops: readonly FlaggedStop[]) => {
      setActionError(null);
      let written = 0;
      for (const stop of stops) {
        const prev = previousDecisionFor(stop);
        if (!prev) continue;
        const saved = await record(
          stop,
          { status: prev.status, reason_code: prev.reason_code },
          "Could not copy last month's decision.",
        );
        if (!saved) break;
        written += 1;
      }
      if (written > 0) await refreshDecisions();
    },
    [previousDecisionFor, record, refreshDecisions],
  );

  // One click, still N real per-stop PUTs - one dated row each, the same as
  // clicking them individually - so the audit trail keeps its shape.
  const copyAllFromPrevious = useCallback(async () => {
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
  }, [flaggedStops, previousDecisionFor, record, refreshDecisions, statusOf]);

  // Reset the month: every decision for it is deleted on the server, so each
  // Flagged Stop returns to pending and the month scores without exclusions
  // until a reviewer decides again. The re-read and both ticks follow the
  // same path as a decision, so Route Summary and the timeline catch up.
  const resetMonth = useCallback(async (): Promise<boolean> => {
    if (!serviceMonth) return false;
    setActionError(null);
    setResetting(true);
    try {
      await api.resetStopExclusions(serviceMonth);
      setDraftReason({});
      await refreshDecisions();
      return true;
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not reset this month's decisions.");
      return false;
    } finally {
      setResetting(false);
    }
  }, [serviceMonth, refreshDecisions]);

  return {
    queueRows,
    statuses,
    statusOf,
    reasonOf,
    setReason,
    previousDecisionFor,
    resolve,
    copyFromPrevious,
    copyAllFromPrevious,
    copyingAll,
    decidedCount: stopExclusions.length,
    resetMonth,
    resetting,
    actionError,
    auditRefreshTick,
    decisionsVersion,
  };
}
