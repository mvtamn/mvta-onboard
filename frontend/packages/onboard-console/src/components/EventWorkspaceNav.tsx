import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useEventWorkspace } from "../context/EventWorkspaceContext.js";

interface Props {
  eventName?: string;
  planName?: string;
  planStatus?: string;
  activeStage?: "plan" | "configure" | "activate" | "monitor";
}

const stages = [
  { id: "plan", label: "Plan", description: "Event and operating period", href: "/events/planning" },
  { id: "configure", label: "Configure", description: "Reusable resources", href: "/admin/events" },
  { id: "activate", label: "Activate", description: "Validate and publish scope", href: "/events/planning" },
  { id: "monitor", label: "Monitor", description: "Live Event AVL", href: "/events/avl" },
] as const;

export function EventWorkspaceNav({ eventName, planName, planStatus, activeStage = "plan" }: Props) {
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
          const stageSuffix = `${stage.href}${suffix}${stage.id === "configure" ? "#event-configuration" : ""}`;
          return <li key={stage.id} ref={isActive ? activeRef : undefined} className={isActive ? "is-active" : isComplete ? "is-complete" : undefined}>
            <NavLink to={stageSuffix} aria-current={isActive ? "step" : undefined}>
              <span className="event-workspace-stage-marker">{isComplete ? "✓" : index + 1}</span>
              <span><strong>{stage.label}</strong><small>{stage.description}</small></span>
            </NavLink>
          </li>;
        })}
      </ol>
    </nav>
  );
}
