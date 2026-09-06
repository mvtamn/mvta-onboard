import { useEffect, useState } from "react";
import {
  ApiError,
  type OtpMonthlyStopRow,
  type OtpReasonCode,
  type OtpHistoricalBackfillResponse,
} from "@mvta/shared";
import { api } from "../config.js";
import {
  deriveCandidatesFromLive,
  DEFAULT_EARLY_LATE_BIAS_THRESHOLD,
} from "./modules/otp/otpData.js";

// OTP Compliance administration - reason codes, the early/late bias
// detection threshold (with its preview-then-apply tuner), and the
// historical feed backfill. These used to be two pages inside the
// Compliance tab's OTP module itself ("Administration" and "Threshold
// Tuner"), which meant anyone with plain OCC.Compliance access could edit
// settings that change every reviewer's queue. They now live here, under
// the Administration workspace's own OCC.Admin gate, alongside the other
// configuration surfaces; the OTP module keeps only the reviewer-facing
// pages and reads the threshold/reason codes this page maintains.

// <input type="month"> uses "YYYY-MM"; the API/DB use "YYYYMM" - local
// copy of the same converter OtpModule.tsx keeps for its month picker.
function fromMonthInputValue(value: string): string {
  return value.replace("-", "");
}

export function OtpComplianceAdmin() {
  const [stopReasonCodes, setStopReasonCodes] = useState<OtpReasonCode[]>([]);
  const [dateReasonCodes, setDateReasonCodes] = useState<OtpReasonCode[]>([]);
  // Missed Trips' investigation-outcome dropdown reuses this same table
  // (migration-023's applies_to='missed_trip') rather than a separate one -
  // managed here alongside the other two for one consistent CRUD surface,
  // even though Missed Trips itself is a different console module.
  const [missedTripReasonCodes, setMissedTripReasonCodes] = useState<OtpReasonCode[]>([]);
  const [threshold, setThreshold] = useState<number>(DEFAULT_EARLY_LATE_BIAS_THRESHOLD);
  // The tuner previews against the current month's real stop rows. Fetched
  // here rather than passed in - this page no longer sits inside the OTP
  // module, so it has no already-fetched feed pull to borrow.
  const [liveStops, setLiveStops] = useState<OtpMonthlyStopRow[] | null>(null);

  function refreshReasonCodes() {
    api.getReasonCodes("stop", true).then((d) => setStopReasonCodes(d.reason_codes)).catch(() => {});
    api.getReasonCodes("date", true).then((d) => setDateReasonCodes(d.reason_codes)).catch(() => {});
    api.getReasonCodes("missed_trip", true).then((d) => setMissedTripReasonCodes(d.reason_codes)).catch(() => {});
  }

  // Each call gets its OWN catch rather than one shared Promise.all - a
  // Promise.all discards every already-succeeded result the moment any one
  // promise rejects, so one flaky call would blank out reason codes that
  // had actually loaded fine.
  useEffect(() => {
    let cancelled = false;
    api
      .getOtpSettings()
      .then((settings) => !cancelled && setThreshold(settings.early_late_bias_threshold))
      .catch(() => {
        /* graceful - the tuner shows the built-in default */
      });
    api
      .getReasonCodes("stop", true)
      .then((d) => !cancelled && setStopReasonCodes(d.reason_codes))
      .catch(() => {
        /* graceful - the table just shows nothing yet */
      });
    api
      .getReasonCodes("date", true)
      .then((d) => !cancelled && setDateReasonCodes(d.reason_codes))
      .catch(() => {
        /* graceful - the table just shows nothing yet */
      });
    api
      .getReasonCodes("missed_trip", true)
      .then((d) => !cancelled && setMissedTripReasonCodes(d.reason_codes))
      .catch(() => {
        /* graceful - the table just shows nothing yet */
      });
    api
      .getOtpMonthly()
      .then((otp) => {
        if (cancelled) return;
        setLiveStops(otp.diagnostics.table_ready && otp.stops.length > 0 ? otp.stops : null);
      })
      .catch(() => {
        /* graceful - the tuner explains it needs live feed data */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="panel-header">OTP Compliance Administration</div>
      <div className="panel-body">
        <p className="panel-desc">
          Reason codes, the early/late bias detection threshold, and historical feed backfill for the
          Compliance tab's OTP Compliance module. Changes here apply to every reviewer.
        </p>

        <ReasonCodeTable
          title="Stop exclusion reason codes"
          hint="Shown in Review Queue's reason dropdown when approving or rejecting a stop."
          appliesTo="stop"
          codes={stopReasonCodes}
          onChanged={refreshReasonCodes}
        />
        <ReasonCodeTable
          title="Date exclusion reason codes"
          hint="Shown in the Weather page's reason dropdown when logging an agency- or route-wide exclusion."
          appliesTo="date"
          codes={dateReasonCodes}
          onChanged={refreshReasonCodes}
        />
        <ReasonCodeTable
          title="Missed Trips reason codes"
          hint="Shown in the Missed Trips module's investigation-outcome dropdown, alongside the free-text notes field."
          appliesTo="missed_trip"
          codes={missedTripReasonCodes}
          onChanged={refreshReasonCodes}
        />

        <div className="subcard" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Threshold tuner</h2>
          <p className="panel-desc">
            A stop/route/day-of-week row is flagged for exclusion review when its early or late share
            of departures exceeds this threshold. Preview the effect on the current month's real feed
            data before applying it.
          </p>
          <ThresholdTunerPage
            liveStops={liveStops}
            currentThreshold={threshold}
            onApplied={(newThreshold) => setThreshold(newThreshold)}
          />
        </div>

        <OtpHistoricalBackfillPanel />
      </div>
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

// Reason-code management for both Review Queue (stop) and Weather (date)
// exclusions - full CRUD (add, inline-rename, reorder, deactivate/
// reactivate). OCC.Admin-only server-side, and now behind the same
// OCC.Admin route gate on the client too.
// No hard delete - deactivating is the app's standing convention for
// retiring a value that older records may still reference (same pattern as
// Detours' soft-delete), so a code used on a past exclusion never goes
// unexplained. sort_order drives dropdown order everywhere this feeds
// (Review Queue, Weather) - the up/down controls swap it with a neighbor.
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

// Preview-then-apply workspace over the current month's stop rows -
// re-deriving the candidate list at a trial threshold is pure, so the
// preview costs no extra fetch. Applying persists the new threshold
// (OtpSettings) for every reviewer, not just this session.
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

  // The saved threshold arrives from its own fetch after this page mounts,
  // so the slider has to follow it once it lands - seeding previewPct from
  // the initial prop alone would leave the slider showing the built-in
  // default rather than the value actually in force.
  useEffect(() => {
    setPreviewPct(Math.round(currentThreshold * 1000) / 10);
  }, [currentThreshold]);

  if (!liveStops) {
    return (
      <div className="empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>
        Threshold tuning previews against the current month's live OTP Monthly feed data - there are
        no rows for this month yet, so there is nothing to preview against. The saved threshold is
        still in force.
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
    <>
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
    </>
  );
}
