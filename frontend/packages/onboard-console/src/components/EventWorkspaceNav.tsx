import { NavLink } from "react-router-dom";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";

interface Props {
  eventName?: string;
  planName?: string;
  planStatus?: string;
}

export function EventWorkspaceNav({ eventName, planName, planStatus }: Props) {
  const { selection } = useEventWorkspace();
  const query = new URLSearchParams();
  if (selection.eventId) query.set("event", selection.eventId);
  if (selection.servicePlanId) query.set("plan", selection.servicePlanId);
  if (selection.revisionId) query.set("revision", selection.revisionId);
  const suffix = query.toString() ? `?${query}` : "";

  return (
    <nav className="event-workspace-nav" aria-label="Event workspace">
      <div>
        <span className="event-workspace-kicker">Event workspace</span>
        <strong>{eventName ?? "No Event selected"}</strong>
        {planName && <span>{planName}{planStatus ? ` · ${planStatus}` : ""}</span>}
      </div>
      <div className="event-workspace-links">
        <NavLink to={`/event-planning${suffix}`}>Plan</NavLink>
        <NavLink to={`/admin${suffix}#event-configuration`}>Configure</NavLink>
        <NavLink to={`/event-monitoring${suffix}`}>Event AVL</NavLink>
      </div>
    </nav>
  );
}
