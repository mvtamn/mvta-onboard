import { useState } from "react";
import { type AdminMessage, CATEGORY_LABELS, formatExpires, ApiError } from "@mvta/shared";
import { api } from "../config.js";

const STATUS_PILL: Record<string, string> = {
  active: "pill-success",
  expired: "pill-muted",
  archived: "pill-muted",
  retracted: "pill-danger",
};

// Audit Log - server-side tag/keyword search across ALL messages (any status)
// via GET /admin/messages. Replaces the earlier client-side active-only filter.
export function AuditLog() {
  const [tag, setTag] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AdminMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { messages } = await api.searchAdminMessages({
        tag: tag.trim() || undefined,
        q: q.trim() || undefined,
      });
      setResults(messages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Search failed (requires staff sign-in).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel-header">Audit Log</div>
      <div className="panel-body">
        <p className="panel-desc">
          Search every message ever posted — active, expired, or retracted — by internal tag or
          keyword.
        </p>
        <form onSubmit={search} className="field-grid" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
          <div>
            <p className="field-label">Tag (exact)</p>
            <input className="f" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. construction" />
          </div>
          <div>
            <p className="field-label">Keyword</p>
            <input className="f" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. elevator" />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button type="submit" className="btn-post" disabled={busy}>
              {busy ? "Searching…" : "Search"}
            </button>
          </div>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
        {results ? (
          results.length === 0 ? (
            <p className="empty-note">No matches.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Tags</th>
                  <th>By</th>
                  <th>Posted</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {results.map((m) => (
                  <tr key={m.message_id}>
                    <td>{m.summary}</td>
                    <td className="td-dim">{CATEGORY_LABELS[m.category] ?? m.category}</td>
                    <td>
                      <span className={`pill-sm ${STATUS_PILL[m.status] ?? "pill-muted"}`}>{m.status}</span>
                    </td>
                    <td className="td-dim">{m.tags.join(", ") || "—"}</td>
                    <td className="td-dim">{m.created_by}</td>
                    <td className="td-dim">{new Date(m.created_at).toLocaleDateString()}</td>
                    <td className="td-dim">{formatExpires(m.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}
      </div>
    </>
  );
}
