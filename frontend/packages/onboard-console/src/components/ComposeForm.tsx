import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  SEVERITIES,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type Category,
  type Severity,
  type ExpirationDefault,
  type GtfsRouteOption,
  ApiError,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";

const ALL_CHANNELS = ["Website", "Mobile app", "Digital signage", "Social media", "SMS", "Push", "Email"];
const DEFAULT_CHANNELS = new Set(["Website", "Mobile app", "SMS", "Email"]);
const TEAMS_TARGETS = [
  { value: "Teams: Operations", label: "Operations" },
  { value: "Teams: Customer Service", label: "Customer Service" },
] as const;
// MVTA Connect (on-demand/paratransit) has no GtfsRoutes row - it's a zone-
// based service, not a fixed route - so it's added as a fixed extra option
// alongside the DB-pulled route list rather than coming from GET /routes.
const MVTA_CONNECT_OPTION = {
  id: "MVTA Connect",
  label: "MVTA Connect",
  title: "On-demand/paratransit service (zone-based, not a fixed route)",
};
// Auto-draft only fires once the internal report has enough content to be
// worth translating - avoids spamming the API on the first few keystrokes.
const AUTO_DRAFT_MIN_LENGTH = 15;
const AUTO_DRAFT_DEBOUNCE_MS = 1500;

// New Announcement form per the approved dashboard mockup.
// Expiration: explicit datetime wins (expiration_source=explicit); otherwise
// the category's default TTL is applied (expiration_source=category_default),
// fetched from /admin/expiration-defaults.
export function ComposeForm({ onPosted }: { onPosted?: () => void }) {
  const { roles } = useAuth();
  const canPublish = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [rawText, setRawText] = useState("");
  const [summary, setSummary] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftedByAi, setDraftedByAi] = useState(false);
  const [category, setCategory] = useState<Category>("delay");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [explicitExpires, setExplicitExpires] = useState("");
  const [tags, setTags] = useState("");
  const [routesText, setRoutesText] = useState("");
  const [selectedRoutes, setSelectedRoutes] = useState<Set<string>>(new Set());
  const [routesList, setRoutesList] = useState<GtfsRouteOption[] | null>(null);
  const [channels, setChannels] = useState<Set<string>>(new Set(DEFAULT_CHANNELS));
  const [teamsEnabled, setTeamsEnabled] = useState(false);
  const [defaults, setDefaults] = useState<ExpirationDefault[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Refs (not state) so the debounced auto-draft effect below always reads
  // the latest value at the moment its timer fires, rather than a stale
  // closure from whenever the effect last ran.
  const summaryRef = useRef(summary);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);
  const draftingRef = useRef(drafting);
  useEffect(() => {
    draftingRef.current = drafting;
  }, [drafting]);

  async function draftSummary() {
    setDraftError(null);
    setDrafting(true);
    try {
      const result = await api.draftMessageSummary({ raw_text: rawText, category, severity });
      setSummary(result.summary);
      setDraftedByAi(true);
    } catch (err) {
      setDraftError(
        err instanceof ApiError ? err.message : "Could not reach the AI drafting service.",
      );
    } finally {
      setDrafting(false);
    }
  }

  // Auto-draft: once staff pause typing the internal report, fill the rider
  // summary automatically - but only while it's still empty/untouched, so an
  // auto-draft never clobbers something staff already wrote or edited.
  useEffect(() => {
    if (rawText.trim().length < AUTO_DRAFT_MIN_LENGTH) return;
    const timer = setTimeout(() => {
      if (!summaryRef.current.trim() && !draftingRef.current) {
        void draftSummary();
      }
    }, AUTO_DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, category, severity]);

  useEffect(() => {
    let alive = true;
    api
      .getExpirationDefaults()
      .then((d) => alive && setDefaults(d.defaults))
      .catch(() => alive && setDefaults(null));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // Falls back to free-text entry (see routesUseList below) if the route
    // registry can't be reached or hasn't been populated yet - Compose stays
    // usable either way.
    api
      .getRoutes()
      .then((d) => alive && setRoutesList(d.routes))
      .catch(() => alive && setRoutesList([]));
    return () => {
      alive = false;
    };
  }, []);

  const routesUseList = (routesList?.length ?? 0) > 0;
  const routeOptions = useMemo(
    () => [
      ...(routesList ?? []).map((r) => ({
        id: r.route_id,
        label: r.route_short_name || r.route_long_name || r.route_id,
        title: r.route_long_name ?? undefined,
      })),
      MVTA_CONNECT_OPTION,
    ],
    [routesList],
  );

  function toggleRoute(routeId: string) {
    setSelectedRoutes((prev) => {
      const next = new Set(prev);
      next.has(routeId) ? next.delete(routeId) : next.add(routeId);
      return next;
    });
  }

  if (!canPublish) {
    return (
      <p className="error-text">
        You need the OCC.Publisher or OCC.Admin role to publish alerts. Ask an administrator to add
        you to the appropriate group.
      </p>
    );
  }

  const categoryTtl = defaults?.find((d) => d.category === category)?.default_ttl_minutes ?? null;

  function toggleChannel(c: string) {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }

  function toggleTeams(enabled: boolean) {
    setTeamsEnabled(enabled);
    setChannels((prev) => {
      const next = new Set(prev);
      for (const target of TEAMS_TARGETS) {
        if (enabled) next.add(target.value);
        else next.delete(target.value);
      }
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    if (
      teamsEnabled &&
      !TEAMS_TARGETS.some((target) => channels.has(target.value))
    ) {
      setError("Select at least one Teams audience.");
      return;
    }

    let expiresAt: string;
    let source: "explicit" | "category_default";
    if (explicitExpires) {
      expiresAt = new Date(explicitExpires).toISOString();
      source = "explicit";
    } else if (categoryTtl !== null) {
      expiresAt = new Date(Date.now() + categoryTtl * 60_000).toISOString();
      source = "category_default";
    } else {
      setError("Set an explicit expiration (category defaults are unavailable right now).");
      return;
    }

    setBusy(true);
    try {
      const res = await api.createMessage({
        raw_text: rawText,
        summary: summary.trim() || undefined,
        category,
        severity,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        routes_affected: routesUseList
          ? [...selectedRoutes]
          : routesText.split(",").map((route) => route.trim()).filter(Boolean),
        channels: [...channels],
        // created_by is intentionally omitted - the server derives it from
        // the verified auth principal (see messagesCreate.ts), not the body.
        expires_at: expiresAt,
        expiration_source: source,
      });
      const teamsNote = teamsEnabled
        ? " Teams routing was recorded; the Teams connector is not active yet."
        : "";
      setOkMsg(
        `Posted. Message ${res.message_id.slice(0, 8)}… expires ${new Date(res.expires_at).toLocaleString()}.${teamsNote}`,
      );
      setRawText("");
      setSummary("");
      setDraftedByAi(false);
      setDraftError(null);
      setTags("");
      setRoutesText("");
      setSelectedRoutes(new Set());
      setExplicitExpires("");
      setChannels(new Set(DEFAULT_CHANNELS));
      setTeamsEnabled(false);
      onPosted?.();
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setError(`${err.message}: ${JSON.stringify(err.details)}`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to post.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="panel-desc">
        Compose a rider-facing announcement. Claude parses category, severity, and expiration
        automatically — review before posting.
      </p>
      <textarea
        className="compose"
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="e.g. Elevator at Mall of America Station out of service until end of day…"
        required
      />
      <div>
        <p className="field-label">
          Rider-facing summary <span className="hint">(what riders will actually see)</span>
        </p>
        <textarea
          className="compose"
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value);
            setDraftedByAi(false);
          }}
          placeholder="Leave blank to use the start of the text above, or draft a rider-friendly version…"
        />
        <button
          type="button"
          className="btn-sm"
          disabled={drafting || !rawText.trim()}
          onClick={() => void draftSummary()}
        >
          {drafting ? "Drafting…" : "Draft rider-friendly text"}
        </button>
        {draftError ? <p className="error-text">{draftError}</p> : null}
      </div>
      <div className="field-grid">
        <div>
          <p className="field-label">Category</p>
          <select className="f" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="field-label">Severity</p>
          <select className="f" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="field-label">Explicit expiration</p>
          <input
            className="f"
            type="datetime-local"
            value={explicitExpires}
            onChange={(e) => setExplicitExpires(e.target.value)}
          />
        </div>
      </div>
      <div>
        <p className="field-label">
          Affected routes{" "}
          <span className="hint">
            {routesUseList ? "(select all that apply)" : "(comma separated)"}
          </span>
        </p>
        {routesUseList ? (
          <div className="channels-row route-select">
            {routeOptions.map((r) => (
              <label key={r.id} title={r.title}>
                <input
                  type="checkbox"
                  checked={selectedRoutes.has(r.id)}
                  onChange={() => toggleRoute(r.id)}
                />
                {r.label}
              </label>
            ))}
          </div>
        ) : (
          <input
            className="f"
            value={routesText}
            onChange={(e) => setRoutesText(e.target.value)}
            placeholder="e.g. 442, 477"
          />
        )}
      </div>
      <div className="field-grid single">
        <div>
          <p className="field-label">
            Tags <span className="hint">(internal only — not shown to riders)</span>
          </p>
          <input
            className="f"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. construction, recurring, winter-weather"
          />
        </div>
      </div>
      <div className="channels-row">
        {ALL_CHANNELS.map((c) => (
          <label key={c}>
            <input type="checkbox" checked={channels.has(c)} onChange={() => toggleChannel(c)} />
            {c}
          </label>
        ))}
      </div>
      <div className={`teams-delivery-card ${teamsEnabled ? "selected" : ""}`}>
        <label className="teams-delivery-toggle">
          <input
            type="checkbox"
            checked={teamsEnabled}
            onChange={(e) => toggleTeams(e.target.checked)}
          />
          <span>
            <strong>Alert via Teams</strong>
            <small>Internal route-impact notification</small>
          </span>
        </label>
        {teamsEnabled ? (
          <div className="teams-delivery-options">
            <p className="field-label">Teams audiences</p>
            <div className="channels-row">
              {TEAMS_TARGETS.map((target) => (
                <label key={target.value}>
                  <input
                    type="checkbox"
                    checked={channels.has(target.value)}
                    onChange={() => toggleChannel(target.value)}
                  />
                  {target.label}
                </label>
              ))}
            </div>
            <p className="teams-connector-note">
              The audience and affected routes will be saved now. A future
              connector will post an Adaptive Card and optional approved image
              to the mapped Teams channels; no Teams post is sent yet.
            </p>
          </div>
        ) : null}
      </div>
      <div className="infer-box">
        <p className="infer-label">Claude's inferred fields</p>
        {explicitExpires ? (
          <span className="chip">Expiration: explicit</span>
        ) : categoryTtl !== null ? (
          <span className="chip">
            Expiration: +{categoryTtl >= 60 ? `${Math.round(categoryTtl / 60)} hr` : `${categoryTtl} min`} ({CATEGORY_LABELS[category]} default)
          </span>
        ) : (
          <span className="chip">Expiration: set explicitly</span>
        )}
        {draftedByAi ? (
          <span className="chip">Rider summary: drafted by Claude</span>
        ) : summary.trim() ? (
          <span className="chip muted">Rider summary: written by hand</span>
        ) : (
          <span className="chip muted">Rider summary: not yet drafted</span>
        )}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {okMsg ? <p className="ok-text">{okMsg}</p> : null}
      <button type="submit" className="btn-post" disabled={busy}>
        {busy ? "Posting…" : "Post Announcement"}
      </button>
    </form>
  );
}
