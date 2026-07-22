import { useCallback, useEffect, useState } from "react";
import {
  type ActiveMessage,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  formatExpires,
  ApiError,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";

const CATEGORY_PILL: Record<string, string> = {
  delay: "pill-warning",
  detour: "pill-warning",
  demand_response_delay: "pill-warning",
  closure: "pill-accent",
  outage: "pill-accent",
  general: "pill-success",
  emergency: "pill-danger",
};
const SEVERITY_PILL: Record<string, string> = {
  informational: "pill-accent",
  minor: "pill-warning",
  major: "pill-danger",
  critical: "pill-danger",
};

// Active Messages table per the dashboard mockup, with Edit (new expiration)
// and Retract actions. The UI gates by role for clarity; the API enforces it.
export function MessagesTable({ onChanged }: { onChanged?: () => void }) {
  const { roles } = useAuth();
  const canWrite = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [messages, setMessages] = useState<ActiveMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editExpires, setEditExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getActiveMessages()
      .then((d) => {
        setMessages(d.messages);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function saveEdit(id: string) {
    if (!editExpires) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.updateMessage(id, { expires_at: new Date(editExpires).toISOString() });
      setEditing(null);
      setEditExpires("");
      load();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function retract(id: string, summary: string) {
    if (!window.confirm(`Retract this message?\n\n"${summary}"\n\nIt will disappear from all rider channels immediately.`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.retractMessage(id);
      load();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Retract failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (messages.length === 0) return <p className="empty-note">No active messages.</p>;

  return (
    <>
      {actionError ? <p className="error-text">{actionError}</p> : null}
      <table className="data">
        <thead>
          <tr>
            <th>Message</th>
            <th>Category</th>
            <th>Severity</th>
            <th>Routes</th>
            <th>Expires</th>
            {canWrite ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.message_id}>
              <td>{m.summary}</td>
              <td>
                <span className={`pill-sm ${CATEGORY_PILL[m.category] ?? "pill-muted"}`}>
                  {CATEGORY_LABELS[m.category] ?? m.category}
                </span>
              </td>
              <td>
                <span className={`pill-sm ${SEVERITY_PILL[m.severity] ?? "pill-muted"}`}>
                  {SEVERITY_LABELS[m.severity] ?? m.severity}
                </span>
              </td>
              <td className="td-dim">{m.routes_affected?.join(", ") || "—"}</td>
              <td>
                {editing === m.message_id ? (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <input
                      className="f"
                      style={{ width: 190 }}
                      type="datetime-local"
                      value={editExpires}
                      onChange={(e) => setEditExpires(e.target.value)}
                    />
                    <button className="btn-sm" disabled={busy} onClick={() => saveEdit(m.message_id)}>
                      Save
                    </button>
                    <button className="btn-sm" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  formatExpires(m.expires_at)
                )}
              </td>
              {canWrite ? (
                <td>
                  {editing === m.message_id ? null : (
                    <>
                      <button
                        className="btn-sm"
                        onClick={() => {
                          setEditing(m.message_id);
                          setEditExpires("");
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn-sm danger" disabled={busy} onClick={() => retract(m.message_id, m.summary)}>
                        Retract
                      </button>
                    </>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
