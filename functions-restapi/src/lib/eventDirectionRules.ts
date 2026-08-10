import { headingInRange } from "./geofence";
import { isGuid } from "./validation";

export type DirectionTransition = "enter" | "exit";
export type DirectionNotificationMode = "manual" | "auto";

export interface DirectionRule {
  id: string;
  geofence_id: string;
  transition: DirectionTransition;
  heading_min: number;
  heading_max: number;
  destination_label: string;
  destination_location_id: string | null;
  send_mode: DirectionNotificationMode;
  sort_order: number;
}

export interface DirectionRuleSnapshot {
  matched_rule_id: string;
  matched_rule_priority: number;
  matched_destination_label: string;
  matched_destination_location_id: string | null;
  matched_send_mode: DirectionNotificationMode;
}

type DirectionRuleInput = Partial<DirectionRule> & Record<string, unknown>;

export function validateDirectionRule(input: DirectionRuleInput, existingRules: DirectionRule[], currentId?: string):
  | { ok: true; value: DirectionRule }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const transition = input.transition;
  const min = input.heading_min;
  const max = input.heading_max;
  const label = input.destination_label;
  const mode = input.send_mode;
  const priority = input.sort_order;

  if (transition !== "enter" && transition !== "exit") errors.push("transition must be enter or exit");
  if (typeof min !== "number" || !Number.isFinite(min) || typeof max !== "number" || !Number.isFinite(max) || min < 0 || min > 360 || max < 0 || max > 360) {
    errors.push("heading_min and heading_max must be finite numbers between 0 and 360");
  }
  if (typeof label !== "string" || label.trim() === "" || label.length > 200) errors.push("destination_label must be a non-empty string of at most 200 characters");
  if (mode !== "manual" && mode !== "auto") errors.push("send_mode must be manual or auto");
  if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0) errors.push("sort_order must be a non-negative integer");
  if (input.destination_location_id !== undefined && input.destination_location_id !== null && !isGuid(input.destination_location_id)) errors.push("destination_location_id must be a GUID or null");
  if (errors.length === 0 && existingRules.some((rule) => rule.id !== (currentId ?? input.id) && rule.transition === transition && rule.sort_order === priority)) {
    errors.push("sort_order must be unique within the geofence and transition");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: String(input.id ?? ""),
      geofence_id: String(input.geofence_id ?? ""),
      transition: transition as DirectionTransition,
      heading_min: min as number,
      heading_max: max as number,
      destination_label: label as string,
      destination_location_id: typeof input.destination_location_id === "string" ? input.destination_location_id : null,
      send_mode: mode as DirectionNotificationMode,
      sort_order: priority as number,
    },
  };
}

export function selectMatchingDirectionRule(rules: DirectionRule[], transition: DirectionTransition, heading: number | null): DirectionRule | undefined {
  return rules
    .filter((rule) => rule.transition === transition && headingInRange(heading, rule.heading_min, rule.heading_max))
    .sort((a, b) => a.sort_order - b.sort_order)[0];
}

export function snapshotMatchedDirectionRule(rule: DirectionRule): DirectionRuleSnapshot {
  return {
    matched_rule_id: rule.id,
    matched_rule_priority: rule.sort_order,
    matched_destination_label: rule.destination_label,
    matched_destination_location_id: rule.destination_location_id,
    matched_send_mode: rule.send_mode,
  };
}
