import { useEffect, useState } from "react";
import { ApiError, DETOUR_LIFECYCLE_LABELS, type DetourWorkflowHistoryEntry } from "@mvta/shared";
import { api } from "../config.js";
import { dateTimeLabel } from "../lib/detourDates.js";

// Append-only operational history for one Detour (GET
// /detours/{id}/workflow-history): creation, state transitions, Avail
// feed observations, manual corrections such as OCC re-review, and
// fulfillment confirmation. Read roles only, so it appears on Detour
// Reports as well as the entry page. Loaded on demand - the list is
// already one request per expanded row for images and communications.

const EVENT_LABELS: Record<DetourWorkflowHistoryEntry["event_type"], string> = {
  created: "Created",
  state_transition: "Workflow",
  source_observation: "Avail observation",
  manual_correction: "Correction",
  fulfillment_confirmation: "Fulfillment confirmed",
};

function transition(entry: DetourWorkflowHistoryEntry): string | null {
  const from = entry.from_state ? DETOUR_LIFECYCLE_LABELS[entry.from_state] : null;
  const to = entry.to_state ? DETOUR_LIFECYCLE_LABELS[entry.to_state] : null;
  if (from && to && from !== to) return `${from} → ${to}`;
  return to ?? from;
}

export function DetourWorkflowHistorySection({ detourId }: { detourId: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<DetourWorkflowHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || history !== null) return;
    api.getDetourWorkflowHistory(detourId)
      .then((r) => setHistory(r.history))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load history."));
  }, [open, history, detourId]);

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn-sm" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? "Hide history" : "Show history"}
      </button>
      {open ? (
        <div className="subcard" style={{ marginTop: 6 }}>
          {error ? <p className="error-text">{error}</p> : null}
          {history === null && !error ? <p className="muted">Loading history…</p> : null}
          {history && history.length === 0 ? <p className="td-dim">No workflow history recorded.</p> : null}
          {history && history.length > 0 ? (
            <table className="data">
              <thead><tr><th>When</th><th>Event</th><th>State</th><th>Detail</th><th>By</th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="td-dim">{dateTimeLabel(entry.changed_at)}</td>
                    <td>{EVENT_LABELS[entry.event_type] ?? entry.event_type}{entry.source === "avail" ? " · Avail" : ""}</td>
                    <td className="td-dim">{transition(entry) ?? "—"}</td>
                    <td>{entry.detail || "—"}</td>
                    <td className="td-dim">{entry.changed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
