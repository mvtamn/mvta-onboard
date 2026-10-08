import assert from "node:assert/strict";
import test from "node:test";
import { isKnownAction } from "./access/catalog";
import { eventPlanAction, eventPlanAuthority, eventPlanRevisionAuthority } from "./eventPlanAuthority";

test("preparing a plan is not the authority that approves it", () => {
  // The defect this table replaced: one permission covered authoring,
  // approving and activating, so a planner could sign off their own work.
  for (const act of ["details", "routes", "geofences", "locations", "modify", "repair", "submit-review"]) {
    assert.equal(eventPlanAuthority(act), "edit", act);
  }
  assert.equal(eventPlanAuthority("approve"), "approve");
});

test("starting, pausing and ending live monitoring take the operating authority", () => {
  for (const act of ["advance", "suspend", "complete"]) {
    assert.equal(eventPlanAuthority(act), "activate", act);
  }
});

test("approving is never enough to activate, and editing is never enough to approve", () => {
  // Stated as the two inequalities the lifecycle depends on, so a later edit
  // that collapses them back into one authority fails here.
  assert.notEqual(eventPlanAuthority("approve"), eventPlanAuthority("advance"));
  assert.notEqual(eventPlanAuthority("submit-review"), eventPlanAuthority("approve"));
});

test("a revision takes the same authorities as the plan it corrects", () => {
  assert.equal(eventPlanRevisionAuthority("submit-review"), "edit");
  assert.equal(eventPlanRevisionAuthority("approve"), "approve");
  assert.equal(eventPlanRevisionAuthority("reject"), "approve");
  // Applying replaces the scope Event AVL and crossing detection are reading,
  // which is an activation however it is spelled.
  assert.equal(eventPlanRevisionAuthority("apply"), "activate");
});

test("an act the table does not know asks for no permission at all", () => {
  // The caller turns null into 404. Falling back to a default permission is
  // how an unlisted act would quietly inherit someone else's authority.
  assert.equal(eventPlanAuthority("destroy"), null);
  assert.equal(eventPlanAuthority(""), null);
  assert.equal(eventPlanRevisionAuthority("advance"), null);
  // Not inherited from Object.prototype either.
  assert.equal(eventPlanAuthority("constructor"), null);
  assert.equal(eventPlanRevisionAuthority("toString"), null);
});

test("every authority names an action the access catalog knows", () => {
  // A handler asking for an action the catalog has never heard of refuses
  // everyone, including an administrator.
  for (const authority of ["edit", "approve", "activate"] as const) {
    assert.ok(isKnownAction(eventPlanAction(authority)), eventPlanAction(authority));
  }
});
