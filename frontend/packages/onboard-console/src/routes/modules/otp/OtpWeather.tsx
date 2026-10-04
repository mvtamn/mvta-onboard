import { useState } from "react";
import { ApiError, type DateExclusionSnapshot, type OtpDateExclusion, type OtpReasonCode } from "@mvta/shared";
import { weatherSentence } from "./otpFigures.js";

export function WeatherPage({
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
