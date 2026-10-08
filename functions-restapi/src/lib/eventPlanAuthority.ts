// Who may move an Event Plan, and why it is not one permission.
//
// Every mutating route on an Event Plan used to resolve its access action from
// the HTTP METHOD - GET read, anything else `event-planning.edit`. So the
// person who drafted a plan could submit it, approve it, activate it, and
// record the reasoned override that let it past a route conflict, with nobody
// else in the loop. The reason that is wrong is not theoretical: the override
// exists to be reviewed, and a reason you write and accept yourself is not a
// review. Spec #75 settled the shape - planning staff prepare and submit,
// authorized reviewers approve, operations activate, suspend and complete.
//
// Mapped here rather than inline in the handler so each lifecycle act names
// its authority once and the whole table can be read, and tested, in one go.

/** Authorities on an Event Plan, in the order the lifecycle uses them. */
export type EventPlanAuthority = "edit" | "approve" | "activate";

const PLAN_AUTHORITY: Record<string, EventPlanAuthority> = {
  // Prepare: authoring the scope, and handing it on for review.
  details: "edit",
  routes: "edit",
  geofences: "edit",
  locations: "edit",
  modify: "edit",
  repair: "edit",
  "submit-review": "edit",
  // Review: accepting the scope, and with it any reasoned conflict override.
  approve: "approve",
  // Operate: what starts, pauses and ends live monitoring.
  advance: "activate",
  suspend: "activate",
  complete: "activate",
};

// A revision runs the same lifecycle against an active plan, so it takes the
// same authorities. `apply` is an activation: it replaces the scope Event AVL
// and crossing detection are reading.
const REVISION_AUTHORITY: Record<string, EventPlanAuthority> = {
  "submit-review": "edit",
  approve: "approve",
  reject: "approve",
  apply: "activate",
};

// The act comes straight off the URL, so a plain lookup answers for the whole
// prototype: `.../constructor` returned Object, which is truthy, and sailed
// past a `?? null` guard instead of being the 404 it is. Own keys only.
function lookUp(table: Record<string, EventPlanAuthority>, action: string): EventPlanAuthority | null {
  return Object.hasOwn(table, action) ? table[action] : null;
}

/**
 * The authority one Event Plan act needs, or null when the act is not one this
 * table knows - the caller answers 404 rather than guessing a permission.
 */
export function eventPlanAuthority(action: string): EventPlanAuthority | null {
  return lookUp(PLAN_AUTHORITY, action);
}

/** The authority one revision act needs, or null for an unknown act. */
export function eventPlanRevisionAuthority(action: string): EventPlanAuthority | null {
  return lookUp(REVISION_AUTHORITY, action);
}

/** The access action an authority resolves to, e.g. `event-planning.approve`. */
export function eventPlanAction(authority: EventPlanAuthority): string {
  return `event-planning.${authority}`;
}
