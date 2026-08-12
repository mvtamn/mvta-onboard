# ADR 0015: Group communications and service-risk monitoring under Service Operations

**Status:** accepted

The staff console groups the common communications and operational-monitoring workflows under a role-aware **Service Operations** navigation area: Overview, Compose, Suggested Alerts, Active Service Alerts, and Service Risk & Quality. Service Risk & Quality contains Fixed Route and On-Demand secondary views. Compose remains a prominent action, and viewers without publishing permission see the capability boundary rather than receiving publish access.

Events, Detour Intake, Compliance, and Performance Assessment remain separate top-level, role-gated areas. They are not placed inside Service Operations because their workflows, permissions, and specialist audiences differ; the parent Service Operations group is visible when the current user can access at least one of its child features, while inaccessible children are hidden.

Customer-facing authored content is called a **Service Alert**. **Suggested Alert** means review is still required, **Active Service Alert** means the approved communication is currently eligible for rider display or delivery, and **Delivery channel** describes the configured destination without claiming delivery success.

The navigation and terminology are intentionally consolidated without collapsing the underlying operational workflows into a single screen. This keeps the common service-operations mental model as monitoring coverage grows while preserving clear boundaries for messaging, risk triage, and specialist functions.
