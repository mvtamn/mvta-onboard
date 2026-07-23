import { useEffect, useState } from "react";
import {
  CATEGORIES,
  SEVERITIES,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type Category,
  type Severity,
  type ExpirationDefault,
  ApiError,
} from "@mvta/shared";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../config.js";

const ALL_CHANNELS = ["Website", "Mobile app", "Digital signage", "Social media", "SMS", "Push", "Email"];
const DEFAULT_CHANNELS = new Set(["Website", "Mobile app", "SMS", "Email"]);

// New Announcement form per the approved dashboard mockup. The "Claude's
// inferred fields" box is a visual placeholder until the Power Automate +
// Claude parsing flow is wired in - fields are manual for now.
// Expiration: explicit datetime wins (expiration_source=explicit); otherwise
// the category's default TTL is applied (expiration_source=category_default),
// fetched from /admin/expiration-defaults.
export function ComposeForm({ onPosted }: { onPosted?: () => void }) {
  const { roles } = useAuth();
  const canPublish = roles.some((r) => r === "OCC.Publisher" || r === "OCC.Admin");

  const [rawText, setRawText] = useState("");
  const [category, setCategory] = useState<Category>("delay");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [explicitExpires, setExplicitExpires] = useState("");
  const [tags, setTags] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set(DEFAULT_CHANNELS));
  const [defaults, setDefaults] = useState<ExpirationDefault[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

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
        category,
        severity,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        channels: [...channels],
        // created_by is intentionally omitted - the server derives it from
        // the verified auth principal (see messagesCreate.ts), not the body.
        expires_at: expiresAt,
        expiration_source: source,
      });
      setOkMsg(`Posted. Message ${res.message_id.slice(0, 8)}… expires ${new Date(res.expires_at).toLocaleString()}.`);
      setRawText("");
      setTags("");
      setExplicitExpires("");
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
        <span className="chip muted">Auto-parse pending Power Automate + Claude integration</span>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {okMsg ? <p className="ok-text">{okMsg}</p> : null}
      <button type="submit" className="btn-post" disabled={busy}>
        {busy ? "Posting…" : "Post Announcement"}
      </button>
    </form>
  );
}
