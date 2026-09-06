import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.0.0",
  date: "Initial release",
  sections: [
    {
      heading: "",
      items: [
        "React + Vite + TypeScript monorepo replacing the original single-file HTML mockups: rider-app (public Service Alerts + opt-in) and onboard-console (Entra-gated staff dashboard).",
        "Full REST API on Azure Functions (TypeScript): messages CRUD/retract, subscribers, admin config, Suggested Alerts human-review queue.",
        "Role-based access control via Entra ID app roles, enforced both client-side (UI gating) and server-side.",
        "OCC Tools: Event Monitoring, Decision Matrix, and OTP Compliance modules, consolidated into one cohesive design system.",
        "Security hardening: CSP/security headers, Front Door + WAF, managed-identity DB/Storage/Service Bus auth, GitHub Actions CI/CD via OIDC federated identity.",
      ],
    },
  ],
};

export default entry;
