// DEV-ONLY. The answer GET /me/access would give, for the mock role switcher.
//
// Mock preview has no token and no API, so it cannot ask the server what a role
// grants. This mirrors the seeded roles in
// functions-restapi/src/lib/access/seeds.ts closely enough to exercise the
// gating; it is never part of a production bundle, and the server is always the
// real answer. If the two drift, mock preview is what is wrong.
import type { MyAccess, MyAccessRole } from "@mvta/shared";

const VIEWER = [
  "dashboard.view",
  "rider-alerts.view",
  "service-risk.view",
  "dispatch-log.view",
  "detours.view",
  "decision-matrix.view",
  "event-avl.view",
  "compliance-review.view",
  "performance-assessment.view",
];

const COMPLIANCE_ANALYST = [
  "compliance-review.view",
  "compliance-review.review",
  "performance-assessment.view",
  "performance-assessment.work",
  "detours.view",
  "dispatch-log.view",
];

// System Administrator holds everything outside Access & Identity.
const ADMINISTRATOR = [
  ...VIEWER,
  "rider-alerts.publish",
  "service-risk.resolve",
  "detours.edit",
  "detours.delete",
  "detours.intake",
  "decision-matrix.manage",
  "speed-alerts.view",
  "event-avl.message",
  "event-avl.notify",
  "event-avl.configure",
  "event-planning.view",
  "event-planning.edit",
  "compliance-review.review",
  "performance-assessment.work",
  "performance-assessment.decide",
  "service-configuration.view",
  "service-configuration.edit",
  "integrations-health.view",
  "integrations-health.edit",
  "contractor-performance.view",
  "contractor-performance.edit",
  "subscribers.view",
  "subscribers.detail",
  "governance-audit.view",
  "dispatch-log.verify",
];

export const MOCK_ROLE_ACTIONS: Record<string, { name: string; actions: string[] }> = {
  "system-administrator": { name: "System Administrator", actions: ADMINISTRATOR },
  publisher: {
    name: "Publisher",
    actions: [...VIEWER, "rider-alerts.publish", "service-risk.resolve", "detours.edit", "detours.delete", "event-avl.notify"],
  },
  viewer: { name: "Viewer", actions: VIEWER },
  "compliance-analyst": { name: "Compliance Analyst", actions: COMPLIANCE_ANALYST },
  "compliance-manager": { name: "Compliance Manager", actions: [...COMPLIANCE_ANALYST, "performance-assessment.decide"] },
  "detour-editor": { name: "Detour Editor", actions: ["detours.view", "detours.edit"] },
  "trip-start-verifier": { name: "Trip Start Verifier", actions: ["dispatch-log.view", "dispatch-log.verify"] },
  "access-administrator": {
    name: "Access Administrator",
    actions: ["access-identity.view", "access-identity.manage", "access-identity.approve", "subscribers.view", "governance-audit.view"],
  },
};

export function mockAccessFor(roleKeys: string[], username: string, displayName: string): MyAccess {
  const roles: MyAccessRole[] = roleKeys
    .filter((key) => MOCK_ROLE_ACTIONS[key])
    .map((key) => ({
      key,
      name: MOCK_ROLE_ACTIONS[key].name,
      purpose: "",
      locked: false,
      source: "onboard",
      scope: null,
      expiresAt: null,
    }));
  const actions = [...new Set(roleKeys.flatMap((key) => MOCK_ROLE_ACTIONS[key]?.actions ?? []))].sort();
  return {
    person: { objectId: "mock-object-id", tenantId: "mock-tenant", name: displayName, email: username },
    roles,
    actions,
    summary: [],
    ingestion: false,
    rolesInOnBoard: true,
  };
}
