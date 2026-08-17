export const EVENT_SCOPE_EXCEPTION_CATEGORIES = [
  "needs_scope_review",
  "telemetry_incomplete",
  "stale_observation",
  "assigned_elsewhere",
] as const;

export type EventScopeExceptionCategory = (typeof EVENT_SCOPE_EXCEPTION_CATEGORIES)[number];

export interface EventScopeExceptionInput {
  route_category: string | null;
  operator_name: string | null;
  block: number | null;
  run: number | null;
  is_stale: boolean;
  is_in_active_scope: boolean;
  has_other_active_scope: boolean;
}
export function classifyEventScopeException(input: EventScopeExceptionInput): EventScopeExceptionCategory | null {
  if (input.route_category !== "SpecialEvent" || input.is_in_active_scope) return null;
  if (!input.operator_name?.trim() || input.block === null || input.run === null) return "telemetry_incomplete";
  if (input.is_stale) return "stale_observation";
  if (input.has_other_active_scope) return "assigned_elsewhere";
  return "needs_scope_review";
}
