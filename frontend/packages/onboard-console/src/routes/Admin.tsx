import { useEffect, useMemo, useState } from "react";
import {
  type ExpirationDefault,
  CATEGORY_LABELS,
  type Category,
  ApiError,
  type RouteClassificationRow,
  type UnclassifiedRoute,
  type RouteCategory,
  ROUTE_CATEGORY_LABELS,
  type GtfsRouteOption,
  type AppSettingRow,
} from "@mvta/shared";
import { api } from "../config.js";
import { useAppDialog } from "../components/AppDialog.js";

const ROUTE_CATEGORIES: RouteCategory[] = ["FixedRoute", "SpecialEvent", "OnDemand"];
const ROUTE_CATEGORY_DESCRIPTIONS: Record<RouteCategory, string> = {
  FixedRoute: "Regular scheduled service",
  SpecialEvent: "Event or supplemental service",
  OnDemand: "Request-based service",
};

export function EventMonitoringSettingsSection() {
  const [setting, setSetting] = useState<AppSettingRow | null>(null);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAppSettings("event")
      .then(({ settings }) => {
        const row = settings.find((item) => item.setting_key === "poll_interval_seconds") ?? null;
        setSetting(row);
        setValue(row?.setting_value ?? "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load Event AVL settings."));
  }, []);

  async function save() {
    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 15 || seconds > 300) {
      setError("Polling interval must be a whole number from 15 through 300 seconds.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.updateAppSetting("event", "poll_interval_seconds", String(seconds));
      setSetting(updated);
      setValue(updated.setting_value);
      setMessage(`Event AVL polling interval updated to ${updated.setting_value} seconds.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update Event AVL settings.");
    } finally {
      setSaving(false);
    }
  }

  return <details className="event-admin-disclosure" open>
    <summary>
      <span><strong>Event AVL settings</strong><small>Control the live-position polling cadence</small></span>
      <span className="event-admin-disclosure-count">{setting ? `${setting.setting_value}s` : "Loading"}</span>
    </summary>
    <div className="event-admin-disclosure-body">
      <p className="panel-desc">Control how often the server retrieves live Avail AVL positions. Changes take effect without a redeploy.</p>
      {error && <p className="error-text">{error}</p>}
      {message && <p className="ok-text">{message}</p>}
      {!setting && !error ? <p className="muted">Loading…</p> : setting && <table className="data">
        <thead><tr><th>Setting</th><th>Current value</th><th>New value</th><th>Last updated</th><th>Actions</th></tr></thead>
        <tbody><tr>
          <td>AVL polling interval</td>
          <td><b>{setting.setting_value} seconds</b></td>
          <td><input className="f" style={{ width: 110 }} type="number" min={15} max={300} step={1} value={value} onChange={(event) => setValue(event.target.value)} /></td>
          <td className="td-dim">{setting.updated_by ? `${setting.updated_by} · ` : ""}{new Date(setting.updated_at).toLocaleDateString()}</td>
          <td><button className="btn-sm" disabled={saving || value === setting.setting_value} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button></td>
        </tr></tbody>
      </table>}
      <p className="muted">Allowed range: 15 seconds to 5 minutes. Faster polling increases Avail API usage.</p>
    </div>
  </details>;
}

// Route Classification editor - no Avail feed distinguishes fixed-route
// from special-event RouteIDs, so this is the one place staff maintain that
// distinction. A light, occasional admin step (per the design doc), not a
// bulk-import workflow - someone adds/updates a row before an event runs.
export function RouteClassificationSection() {
  const { confirm } = useAppDialog();
  const [routes, setRoutes] = useState<RouteClassificationRow[] | null>(null);
  const [unclassified, setUnclassified] = useState<UnclassifiedRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [routeIdInput, setRouteIdInput] = useState("");
  const [category, setCategory] = useState<RouteCategory>("SpecialEvent");
  const [label, setLabel] = useState("");
  const [routeSearch, setRouteSearch] = useState("");

  // Same registry (GtfsRoutes via GET /routes) already backing Compose's
  // affected-routes selector - picking a known route beats typing a raw
  // numeric ID blind. Falls back to the free-text input if the registry
  // can't be reached or is empty, same graceful-degradation convention as
  // Compose.
  const [routesList, setRoutesList] = useState<GtfsRouteOption[] | null>(null);

  function load() {
    api
      .getRouteClassification()
      .then((d) => {
        setRoutes(d.routes);
        // Defensive against an old-backend/new-frontend deploy transition -
        // `unclassified` is a newly-added response field; never assume a
        // backend field is present just because this build expects it.
        setUnclassified(d.unclassified ?? []);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load route classifications."));
  }

  useEffect(load, []);

  useEffect(() => {
    let alive = true;
    api
      .getRoutes()
      .then((d) => alive && setRoutesList(d.routes))
      .catch(() => alive && setRoutesList([]));
    return () => {
      alive = false;
    };
  }, []);

  const routesUseSelector = (routesList?.length ?? 0) > 0;
  // GTFS routes UNION the RouteIDs AVL Reports has actually reported - a
  // GTFS-only picker is exactly wrong for this page. Special service is not
  // published in the GTFS static schedule (and so is absent from GTFS-RT
  // too), so the very RouteIDs this editor exists to classify could never
  // appear in a GtfsRoutes-derived list. AVL Reports is the one feed where a
  // vehicle logged into a special route shows up at all, which is why the
  // `unclassified` half of GET /route-classification is merged in here.
  const routeOptions = useMemo(() => {
    const gtfs = (routesList ?? []).map((r) => ({
      id: r.route_id,
      label: r.route_short_name || r.route_long_name || r.route_id,
      title: r.route_long_name ?? undefined,
      avlOnly: false,
    }));
    const gtfsIds = new Set(gtfs.map((o) => String(o.id)));
    const avlOnly = unclassified
      .filter((u) => !gtfsIds.has(String(u.route_id)))
      .map((u) => ({
        id: String(u.route_id),
        label: u.suggested_label ? `${u.route_id} · ${u.suggested_label}` : String(u.route_id),
        title: "Seen in live AVL data, not in the GTFS schedule - likely special service",
        avlOnly: true,
      }));
    return [...gtfs, ...avlOnly].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  }, [routesList, unclassified]);
  const filteredRouteOptions = useMemo(() => {
    const q = routeSearch.trim().toLowerCase();
    if (!q) return routeOptions;
    return routeOptions.filter((r) => r.label.toLowerCase().includes(q) || String(r.id).includes(q));
  }, [routeOptions, routeSearch]);

  function startEdit(r: RouteClassificationRow) {
    setEditingId(r.route_id);
    setRouteIdInput(String(r.route_id));
    setCategory(r.route_category);
    setLabel(r.route_label ?? "");
    setOkMsg(null);
    setRouteSearch("");
  }

  function startNew() {
    setEditingId(null);
    setRouteIdInput("");
    setCategory("SpecialEvent");
    setLabel("");
    setOkMsg(null);
    setRouteSearch("");
  }

  // Pre-fills the form from a discovered RouteID rather than an admin
  // typing one blind - the naming-convention pre-fill this page originally
  // needed AVL Reports to carry a route name for, which it doesn't (see
  // routeClassification.ts's UnclassifiedRouteRow comment) - a suggested
  // label from OTP/Missed Trips when available is the closest substitute.
  function classifyFromSuggestion(u: UnclassifiedRoute) {
    setEditingId(null);
    setRouteIdInput(String(u.route_id));
    setCategory("SpecialEvent");
    setLabel(u.suggested_label ?? "");
    setOkMsg(null);
    setRouteSearch("");
  }

  async function save() {
    const routeId = parseInt(routeIdInput, 10);
    if (!Number.isInteger(routeId)) {
      setError("Route ID must be a whole number.");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const existing = routes?.find((row) => row.route_id === routeId);
      await api.putRouteClassification(routeId, {
        route_category: category,
        route_label: label.trim() || null,
        expected_updated_at: existing?.updated_at,
      });
      setOkMsg(`Route ${routeId} classified as ${ROUTE_CATEGORY_LABELS[category]}.`);
      startNew();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  // Hard delete, not deactivate - see routeClassification.ts's header
  // comment for why that's the right call for this specific table. Added
  // per Ty's live report: no way existed to remove a route reclassified
  // for testing.
  async function remove(r: RouteClassificationRow) {
    if (!await confirm({ title: `Remove Route ${r.route_id} classification?`, description: "The route will return to unclassified and be treated as fixed route service.", confirmLabel: "Remove classification", danger: true })) {
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      await api.deleteRouteClassification(r.route_id);
      setOkMsg(`Route ${r.route_id}'s classification removed.`);
      if (editingId === r.route_id) startNew();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="event-admin-disclosure" open>
      <summary>
        <span><strong>Route classification</strong><small>Identify fixed, special-event, and on-demand service</small></span>
        <span className="event-admin-disclosure-count">{routes ? `${routes.length} classified` : "Loading"}</span>
      </summary>
      <div className="event-admin-disclosure-body">
        <p className="panel-desc">
          No Avail feed distinguishes a fixed route from a special-event route - classify RouteIDs
          here so the OTP/Missed Trips/AVL integrations and the event-bus live map know which is
          which. Unclassified routes are treated as fixed route by default.
        </p>
        <p className="panel-desc" style={{ marginTop: 0 }}>
          The Route ID list below covers both the GTFS schedule and RouteIDs seen in live AVL data
          (marked <span className="hint">(AVL)</span>) - special service never appears in GTFS, so
          the schedule alone would not list the routes most worth classifying. A RouteID in neither
          can be typed in directly.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        {okMsg ? <p className="ok-text">{okMsg}</p> : null}

        {unclassified.length > 0 ? (
          <div className="subcard" style={{ marginBottom: 16 }}>
            <p className="field-label" style={{ marginBottom: 8 }}>
              Seen in live AVL data, not yet classified ({unclassified.length})
            </p>
            <p className="panel-desc" style={{ marginTop: 0 }}>
              AVL Reports carries only a bare RouteID, no name - these are RouteIDs Avail has
              actually reported vehicle positions for that have no row below yet. Label is a
              best-effort guess from OTP/Missed Trips data when available, not a guarantee.
            </p>
            <table className="data">
              <thead>
                <tr><th>Route ID</th><th>Suggested label</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {unclassified.map((u) => (
                  <tr key={u.route_id}>
                    <td>{u.route_id}</td>
                    <td>{u.suggested_label || "—"}</td>
                    <td>
                      <button className="btn-sm" onClick={() => classifyFromSuggestion(u)}>
                        Classify as Special Event
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="subcard" style={{ marginBottom: 16 }}>
          <div className="field-grid">
            <div>
              <p className="field-label">Route ID</p>
              {routesUseSelector && editingId === null ? (
                <>
                  <input
                    className="f"
                    style={{ marginBottom: 6 }}
                    value={routeSearch}
                    onChange={(e) => setRouteSearch(e.target.value)}
                    placeholder="Search routes…"
                  />
                  <div className="channels-row route-select">
                    {filteredRouteOptions.length === 0 ? (
                      <span className="muted">No routes match “{routeSearch}”.</span>
                    ) : (
                      filteredRouteOptions.map((r) => (
                        <label key={r.id} title={r.title}>
                          <input
                            type="radio"
                            name="route-classification-picker"
                            checked={routeIdInput === String(r.id)}
                            onChange={() => setRouteIdInput(String(r.id))}
                          />
                          {r.label}
                          {r.avlOnly ? <span className="hint"> (AVL)</span> : null}
                        </label>
                      ))
                    )}
                  </div>
                  {/* Always reachable, not a fallback: a brand-new event
                      RouteID that has not run yet is in neither GTFS nor AVL
                      data, so neither list above can offer it. Before this,
                      routesUseSelector being true made the free-text input
                      below unreachable and such an ID simply un-enterable. */}
                  <input
                    className="f"
                    type="number"
                    style={{ marginTop: 6 }}
                    value={routeOptions.some((r) => String(r.id) === routeIdInput) ? "" : routeIdInput}
                    onChange={(e) => setRouteIdInput(e.target.value)}
                    placeholder="Or type a RouteID not listed - e.g. 1111"
                  />
                </>
              ) : (
                <input
                  className="f"
                  type="number"
                  value={routeIdInput}
                  disabled={editingId !== null}
                  onChange={(e) => setRouteIdInput(e.target.value)}
                  placeholder="e.g. 90"
                />
              )}
            </div>
            <div>
              <p className="field-label">Category</p>
              <select className="f" value={category} onChange={(e) => setCategory(e.target.value as RouteCategory)}>
                {ROUTE_CATEGORIES.map((c) => (
                  <option value={c} key={c}>{ROUTE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="field-label">Label <span className="hint">(optional)</span></p>
              <input className="f" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Vikings Game Shuttle" />
            </div>
          </div>
          <button className="btn-post" disabled={busy || !routeIdInput} onClick={save}>
            {busy ? "Saving…" : editingId !== null ? "Update" : "Add classification"}
          </button>
          {editingId !== null ? <button className="btn-sm" onClick={startNew}>Cancel</button> : null}
        </div>

        {routes === null && !error ? (
          <p className="muted">Loading…</p>
        ) : routes && routes.length > 0 ? (
          <div className="route-classification-table-wrap">
            <div className="route-classification-table-heading">
              <div>
                <h3>Classified routes</h3>
                <p>These labels are used by Event AVL and operational reports.</p>
              </div>
              <span className="route-classification-count">{routes.length} {routes.length === 1 ? "route" : "routes"}</span>
            </div>
          <table className="data route-classification-table">
            <thead>
              <tr><th scope="col">Route</th><th scope="col">Service type</th><th scope="col">Display label</th><th scope="col">Last updated</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route_id}>
                  <td>
                    <strong className="route-classification-id">Route {r.route_id}</strong>
                    <span className="td-subtle">Operational identifier</span>
                  </td>
                  <td>
                    <span className="pill-sm pill-accent">{ROUTE_CATEGORY_LABELS[r.route_category]}</span>
                    <span className="td-subtle">{ROUTE_CATEGORY_DESCRIPTIONS[r.route_category]}</span>
                  </td>
                  <td>
                    <strong>{r.route_label || "No display label"}</strong>
                    {!r.route_label ? <span className="td-subtle">Add one to help operators recognize this service</span> : null}
                  </td>
                  <td className="route-classification-updated">
                    <strong>{new Date(r.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong>
                    <span className="td-subtle">{r.updated_by ? `by ${r.updated_by}` : "by system"}</span>
                  </td>
                  <td className="route-classification-actions">
                    <button className="btn-sm" aria-label={`Edit classification for Route ${r.route_id}`} onClick={() => startEdit(r)}>Edit classification</button>
                    <button className="btn-sm danger" aria-label={`Remove classification for Route ${r.route_id}`} disabled={busy} onClick={() => remove(r)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <p className="empty-note">No routes classified yet - unclassified routes default to fixed route.</p>
        )}
      </div>
    </details>
  );
}

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
      <div className="panel-header">Configuration — Service Alert Defaults</div>
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
