import type { Tone } from "./AccessUi.js";

// The audit trail records machine action and outcome codes. People read these
// words instead; an unknown code falls back to the code made readable, so a
// new action on the API shows up rather than disappearing.
const ACTIONS: Record<string, string> = {
  access_grant: "Granted access",
  access_revoke: "Removed access",
  guest_invitation: "Invited a guest",
  grant: "Granted access",
  revoke: "Removed access",
  invite_guest: "Invited a guest",
  access_change_previewed: "Checked a change",
  access_expired: "Access expired",
  access_expiry_failed: "Expiry failed",
  access_inventory_exported: "Exported the inventory",
  access_reconciliation_viewed: "Checked access health",
  sign_in_details_viewed: "Viewed sign-ins",
  privileged_change_requested: "Requested a privileged change",
  privileged_removal_requested: "Requested a privileged removal",
  privileged_change_approved: "Approved a privileged change",
  privileged_change_rejected: "Rejected a privileged change",
  privileged_change_cancelled: "Cancelled a privileged request",
  privileged_change_expired: "Privileged request expired",
  privileged_change_failed: "Privileged change failed",
  privileged_change_blocked: "Blocked a privileged change",
  role_created: "Created a role",
  role_edited: "Edited a role",
  role_archived: "Archived a role",
};

/**
 * Looking at access is recorded too, and on a quiet week it is most of what the
 * record holds. The Overview shows what changed; the Activity log still shows
 * everything, which is where somebody goes to see who looked.
 */
const LOOKED_AT = new Set([
  "access_change_previewed",
  "access_inventory_exported",
  "access_reconciliation_viewed",
  "sign_in_details_viewed",
]);

export const isChange = (action: string) => !LOOKED_AT.has(action);

const OUTCOMES: Record<string, [Tone, string]> = {
  completed: ["ok", "Completed"],
  approved: ["ok", "Approved"],
  validated: ["ok", "Checked"],
  pending: ["warn", "Waiting"],
  pending_approval: ["warn", "Waiting"],
  cancelled: ["mute", "Cancelled"],
  expired: ["mute", "Expired"],
  rejected: ["mute", "Rejected"],
  already_satisfied: ["mute", "No change needed"],
  failed: ["bad", "Failed"],
  blocked: ["bad", "Blocked"],
  validation_failed: ["bad", "Didn’t pass checks"],
  recovery_invariant: ["bad", "Needs investigation"],
};

const readable = (code: string) => {
  const text = code.replace(/_/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Unknown";
};

export const actionLabel = (action: string) => ACTIONS[action] ?? readable(action);

export function outcomeOf(outcome: string): { tone: Tone; label: string } {
  const known = OUTCOMES[outcome];
  return known ? { tone: known[0], label: known[1] } : { tone: "mute", label: readable(outcome) };
}

export const outcomeNeedsLook = (outcome: string) => outcomeOf(outcome).tone === "bad";
