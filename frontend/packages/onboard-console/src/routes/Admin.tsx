import { useEffect, useState } from "react";
import { type ExpirationDefault, CATEGORY_LABELS, type Category, ApiError } from "@mvta/shared";
import { api } from "../config.js";

// Admin - expiration defaults editor. These TTLs drive expires_at whenever a
// message is created without an explicit expiration (expiration_source =
// category_default). PATCH is OCC.Admin-only, enforced server-side.
export function Admin() {
  const [defaults, setDefaults] = useState<ExpirationDefault[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getExpirationDefaults()
      .then((d) => alive && setDefaults(d.defaults))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load (requires staff sign-in)."));
    return () => {
      alive = false;
    };
  }, []);

  async function save(category: Category) {
    const value = parseInt(edits[category] ?? "", 10);
    if (!Number.isInteger(value)) return;
    setBusy(category);
    setError(null);
    setOkMsg(null);
    try {
      const updated = await api.updateExpirationDefault(category, value);
      setDefaults((prev) =>
        prev
          ? prev.map((d) => (d.category === category ? { ...d, default_ttl_minutes: updated.default_ttl_minutes } : d))
          : prev,
      );
      setEdits((prev) => ({ ...prev, [category]: "" }));
      setOkMsg(`${CATEGORY_LABELS[category]} default updated to ${updated.default_ttl_minutes} minutes.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="panel-header">Admin — Expiration Defaults</div>
      <div className="panel-body">
        <p className="panel-desc">
          Default time-to-live per category, applied when an announcement is posted without an
          explicit expiration.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {okMsg ? <p className="ok-text">{okMsg}</p> : null}
        {defaults === null && !error ? (
          <p className="muted">Loading…</p>
        ) : defaults ? (
          <table className="data">
            <thead>
              <tr>
                <th>Category</th>
                <th>Default TTL (minutes)</th>
                <th>Last updated</th>
                <th>New value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {defaults.map((d) => (
                <tr key={d.category}>
                  <td>{CATEGORY_LABELS[d.category] ?? d.category}</td>
                  <td>
                    <b>{d.default_ttl_minutes}</b>{" "}
                    <span className="td-dim">({Math.round((d.default_ttl_minutes / 60) * 10) / 10} hr)</span>
                  </td>
                  <td className="td-dim">
                    {d.updated_by ? `${d.updated_by} · ` : ""}
                    {new Date(d.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <input
                      className="f"
                      style={{ width: 110 }}
                      type="number"
                      min={5}
                      max={43200}
                      value={edits[d.category] ?? ""}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [d.category]: e.target.value }))}
                      placeholder={String(d.default_ttl_minutes)}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-sm"
                      disabled={busy === d.category || !edits[d.category]}
                      onClick={() => save(d.category)}
                    >
                      {busy === d.category ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}
