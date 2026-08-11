import { createContext, useCallback, useContext, useMemo, type PropsWithChildren } from "react";
import { useSearchParams } from "react-router-dom";

export interface EventWorkspaceSelection {
  eventId: string;
  servicePlanId: string;
  revisionId: string;
}

interface EventWorkspaceContextValue {
  selection: EventWorkspaceSelection;
  selectEvent: (eventId: string) => void;
  selectServicePlan: (servicePlanId: string) => void;
  selectRevision: (revisionId: string) => void;
  clearSelection: () => void;
}

const EventWorkspaceContext = createContext<EventWorkspaceContextValue | null>(null);

function selectionFromParams(params: URLSearchParams): EventWorkspaceSelection {
  return {
    eventId: params.get("event") ?? "",
    servicePlanId: params.get("plan") ?? "",
    revisionId: params.get("revision") ?? "",
  };
}

export function EventWorkspaceProvider({ children }: PropsWithChildren) {
  const [params, setParams] = useSearchParams();
  const selection = useMemo(() => selectionFromParams(params), [params]);

  const update = useCallback((next: EventWorkspaceSelection) => {
    const updated = new URLSearchParams(params);
    updated.delete("event"); updated.delete("plan"); updated.delete("revision");
    if (next.eventId) updated.set("event", next.eventId);
    if (next.servicePlanId) updated.set("plan", next.servicePlanId);
    if (next.revisionId) updated.set("revision", next.revisionId);
    setParams(updated);
  }, [params, setParams]);

  const value = useMemo<EventWorkspaceContextValue>(() => ({
    selection,
    selectEvent: (eventId) => update({ eventId, servicePlanId: "", revisionId: "" }),
    selectServicePlan: (servicePlanId) => update({ ...selection, servicePlanId, revisionId: "" }),
    selectRevision: (revisionId) => update({ ...selection, revisionId }),
    clearSelection: () => update({ eventId: "", servicePlanId: "", revisionId: "" }),
  }), [selection, update]);

  return <EventWorkspaceContext.Provider value={value}>{children}</EventWorkspaceContext.Provider>;
}

export function useEventWorkspace() {
  const context = useContext(EventWorkspaceContext);
  if (!context) throw new Error("useEventWorkspace must be used inside EventWorkspaceProvider");
  return context;
}
