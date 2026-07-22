import {
  type ActiveMessage,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  badge,
  timeAgo,
  formatExpires,
} from "@mvta/shared";

// All server-supplied text (summary, route labels) is rendered as JSX text
// content, so React escapes it automatically. This is the structural fix for
// the stored-XSS hole in the old demo_service_alerts.html, which built card
// markup with template strings and injected it via innerHTML.
export function AlertCard({ m }: { m: ActiveMessage }) {
  const routeLabel =
    m.routes_affected?.length
      ? m.routes_affected.join(", ")
      : m.zones_affected?.length
        ? "Zona: " + m.zones_affected.join(", ")
        : m.stops_affected?.length
          ? m.stops_affected.join(", ")
          : "All routes";

  const posted = timeAgo(m.created_at);
  const catStyle = badge[m.category];
  const sevStyle = badge[m.severity];

  return (
    <div className="card">
      <div className="card-top">
        <span
          className="badge"
          style={catStyle ? { background: catStyle.bg, color: catStyle.fg } : undefined}
        >
          {CATEGORY_LABELS[m.category] ?? m.category}
        </span>
        <span
          className="badge"
          style={sevStyle ? { background: sevStyle.bg, color: sevStyle.fg } : undefined}
        >
          {SEVERITY_LABELS[m.severity] ?? m.severity}
        </span>
        <span className="card-route">{routeLabel}</span>
      </div>
      <p className="card-text">{m.summary}</p>
      <div className="card-meta">
        {posted ? <span>Posted {posted}</span> : null}
        <span>Expires {formatExpires(m.expires_at)}</span>
      </div>
    </div>
  );
}
