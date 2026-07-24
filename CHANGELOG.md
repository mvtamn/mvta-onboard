# Changelog

All notable changes to MVTA OnBoard are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions track
`frontend/packages/onboard-console/package.json` (the staff console's `v`
badge and footer read this version at build time - see `vite.config.ts`).

## [Unreleased]

- Confirmation + STOP/HELP subscriber endpoints (blocked on Azure
  Communication Services provisioning).
- **Known live-environment issue:** the Function App's Easy Auth
  `allowedAudiences` setting is not yet applied on `func-mvta-restapi-dev`
  (Bicep has the fix; the live resource doesn't), so real Entra sign-ins
  currently get "Not authenticated" on authenticated reads/writes until an
  infra deploy or a direct `az webapp auth` fix is applied.

## [1.1.0] - 2026-07-24

### Added
- GTFS-Realtime Alert feed ingestion (Phase 1): bridges MVTA's
  dispatcher-entered CAD detour/service-change notices into the Suggested
  Alerts human-review queue, deduped by feed entity ID.
- GTFS-Realtime TripUpdate delay detection (Phase 2): a 5-minute poll logs
  every monitored trip's live delay (all delays reported, regardless of
  size) and escalates a delay sustained over 15 minutes across 2
  consecutive polls into a Suggested Alerts candidate, with real stop
  names resolved from a daily static-GTFS sync. New **Live Delays** module
  in OCC Tools shows every monitored trip's current status.
- Automatic retry-with-backoff on GET requests in the shared API client,
  to absorb transient Front Door edge-node propagation flakiness.
- Redesigned staff console sign-in screen (centered card, brand gradient
  backdrop) to match MVTA's other internal tools.
- This changelog, and a build-time app version badge wired to
  `package.json` instead of a hand-maintained string.

### Fixed
- Onboard-console blank page when served through Azure Front Door at
  `/console/*` - Front Door forwards requests without stripping the
  `/console` prefix, and the server-side rewrite rule meant to do that
  never reliably applied; the build now nests its own output under a
  literal `console/` folder so the deployed paths match the requested
  URLs directly, with no rewrite dependency.
- Rider-app "Failed to fetch" on Service Alerts, caused by a misconfigured
  `VITE_API_BASE` GitHub Actions variable pointing at the Function App's
  raw hostname (blocked by the app's own CSP) instead of a same-origin
  relative path.
- `created_by` on message creation is now derived from the verified auth
  principal server-side rather than trusted from the request body, except
  for the `System.Ingestion` service-principal fallback.

## [1.0.0] - Initial release

- React + Vite + TypeScript monorepo replacing the original single-file
  HTML mockups: **rider-app** (public Service Alerts + opt-in) and
  **onboard-console** (Entra-gated staff dashboard).
- Full REST API on Azure Functions (TypeScript): messages CRUD/retract,
  subscribers, admin config, Suggested Alerts human-review queue.
- Role-based access control via Entra ID app roles (OCC.Viewer/
  Publisher/Admin, System.Ingestion), enforced both client-side (UI
  gating) and server-side (`requireRole`).
- OCC Tools: Event Monitoring, Decision Matrix, and OTP Compliance
  modules, consolidated into one cohesive design system.
- Security hardening: CSP/security headers, Front Door + WAF, managed-
  identity DB/Storage/Service Bus auth (no standing secrets), GitHub
  Actions CI/CD via OIDC federated identity.
