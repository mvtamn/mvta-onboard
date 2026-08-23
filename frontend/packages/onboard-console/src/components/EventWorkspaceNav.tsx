import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";

interface Props {
  eventName?: string;
  planName?: string;
  planStatus?: string;
  activeStage?: "plan" | "configure" | "review" | "activate";
  showReturnToPlanning?: boolean;
}

// Event Planning is one page, so Plan, Review and Activate are not places you
// can navigate to - they describe where the Event Plan has got to. Rendering
// them as links pointed all three at the same `/events/planning`, so choosing
// "Review" reloaded the page you were already on and appeared broken. Only
// Configure names a genuinely different route.
const stages = [
  { id: "plan", label: "Plan", description: "Event and Event Plan", href: undefined },
  { id: "configure", label: "Configure", description: "Reusable resources", href: "/admin/events" },
  { id: "review", label: "Review", description: "Readiness and evidence", href: undefined },
  { id: "activate", label: "Activate", description: "Publish internal scope", href: undefined },
] as const;

export function EventWorkspaceNav({ eventName, planName, planStatus, activeStage = "plan", showReturnToPlanning = false }: Props) {
  const { selection } = useEventWorkspace();
  const query = new URLSearchParams();
  if (selection.eventId) query.set("event", selection.eventId);
  if (selection.servicePlanId) query.set("plan", selection.servicePlanId);
  if (selection.revisionId) query.set("revision", selection.revisionId);
  const suffix = query.toString() ? `?${query}` : "";

  // Below 700px the stage list scrolls horizontally instead of squeezing
  // labels into an unreadable quarter-width column (see .event-workspace-stages
  // in styles.css) - this keeps whichever stage is active in view on mount
  // instead of leaving the user to discover it by swiping.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" }); }, [activeStage]);

  return (
    <nav className="event-workspace-nav" aria-label="Event workspace">
      <div className="event-workspace-context">
        <span className="event-workspace-kicker">Event workspace</span>
        <strong>{eventName ?? "No Event selected"}</strong>
        {planName && <span>{planName}{planStatus ? ` · ${planStatus}` : ""}</span>}
      </div>
      <ol className="event-workspace-stages">
        {stages.map((stage, index) => {
          const isActive = stage.id === activeStage;
          const isComplete = index < stages.findIndex((item) => item.id === activeStage);
          const body = <>
            <span className="event-workspace-stage-marker">{isComplete ? "✓" : index + 1}</span>
            <span><strong>{stage.label}</strong><small>{stage.description}</small></span>
          </>;
          return <li key={stage.id} ref={isActive ? activeRef : undefined} className={isActive ? "is-active" : isComplete ? "is-complete" : undefined}>
            {stage.href
              ? <NavLink to={`${stage.href}${suffix}#event-configuration`} aria-current={isActive ? "step" : undefined}>{body}</NavLink>
              : <span className="event-workspace-stage-status" aria-current={isActive ? "step" : undefined}>{body}</span>}
          </li>;
        })}
      </ol>
      {showReturnToPlanning && <NavLink className="event-workspace-return" to={`/events/planning${suffix}`}>Return to Event Planning</NavLink>}
    </nav>
  );
}
