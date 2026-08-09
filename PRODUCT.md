# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- MVTA Operations Control Center and operations staff use the OnBoard Console to monitor service, investigate exceptions, coordinate responses, review evidence, manage communications, and administer governed workflows.
- Public transit riders use the rider-facing application to see active service alerts and subscribe to notifications. The public experience is a first-class, extremely important part of the product, not a secondary administrative output.
- OCC leadership, compliance staff, product owners, developers, and implementation partners use operational records, reporting, configuration, and supporting documentation according to their roles.

## Product Purpose

MVTA OnBoard complements MVTA's source CAD/AVL and transit systems by detecting service risks, supporting operational decisions, automating current internal processes, and helping staff publish timely, accurate rider communications.

Success means OCC staff receive actionable warning and evidence early enough to intervene; internal procedures become consistent, governed workflows; authorized staff can review and publish communications efficiently; and riders can reliably understand service impacts and opt into relevant notifications.

## Positioning

OnBoard unifies MVTA-specific operational monitoring, exception review, governed decision support, compliance evidence, and human-approved public communication without replacing the source operational systems. Automated detection may prepare a suggested alert, but never publishes directly to riders: an authorized person must approve customer-facing messages.

## Operating Context

- Staff work in a role-gated web console covering dashboards, message composition, active messages, detours and closures, suggested alerts, subscribers, audit history, administration, OCC tools, and compliance.
- Operational workflows consume or reconcile GTFS, GTFS-Realtime, Avail, vendor, and internal application data. Some modules use live data while others retain preview, sample, or partially implemented states that must be identified honestly.
- The rider web application displays active service alerts and supports SMS/email notification opt-in and alert-category selection.
- Local mock authentication is for interface preview only and must never be represented as live operational access or data.
- The current `dev` Azure environment is the only live environment and effectively serves as production until separate test and production environments exist.

## Capabilities and Constraints

- Preserve the separate but equally consequential experiences: the internal OnBoard Console and the public rider application.
- Preserve human review and authorization before any suggested alert becomes a rider-facing publication.
- Preserve Microsoft Entra authentication, server-enforced role-based access, and the established OCC role boundaries.
- Preserve strict Content Security Policy compatibility and the repository's security posture; do not introduce inline scripts, unapproved external assets, or assumptions that weaken current controls.
- Preserve Azure deployment compatibility, the React/Vite/TypeScript frontend workspace structure, Azure Functions services, and infrastructure-as-code workflows unless a change is explicitly approved.
- Preserve data-source truth, operational terminology, threshold rules, auditability, and clear distinctions among live, preview, sample, pending, and unavailable functionality.
- Protect rider information and consent flows. Do not imply that incomplete confirmation callbacks, resend, inbound SMS, `STOP`, or `HELP` workflows are production-ready.
- Automation should reduce repetitive internal work while retaining accountable human judgment for consequential operational and public communication decisions.

## Brand Commitments

- Preserve MVTA identity and branding across staff and public experiences.
- Voice should be direct, calm, trustworthy, operationally precise, and understandable to the public.
- Public messages must prioritize useful service information over internal system language.
- Existing repository assets, terminology, and approved interface patterns are binding evidence unless the user explicitly authorizes a redesign or rebrand.

## Evidence on Hand

- `MVTA_ONBOARD_MANUAL.md` is the current repository-level operational, product, technical, deployment, and roadmap source of truth.
- `README.md`, `CURRENT_STATE.md`, `CHANGELOG.md`, `HANDOFF.md`, and the documents under `plans/` provide implementation status, history, and scoped requirements.
- `frontend/packages/rider-app/` contains the public service-alert and notification opt-in experience.
- `frontend/packages/onboard-console/` contains the authenticated staff console and its operational and compliance modules.
- `frontend/packages/shared/` contains shared design tokens, domain types, formatting, and API infrastructure.
- `retired-mockups/` contains historical design references, not the current implementation authority.
- The repository contains no license to fabricate customer testimonials, adoption claims, performance benchmarks, service reliability claims, pricing, or completion status.

## Product Principles

1. Treat rider clarity and staff operational effectiveness as co-equal product outcomes.
2. Automate preparation, detection, and routine internal process work while keeping consequential decisions governed and accountable.
3. Make operational truth visible: distinguish live data, previews, samples, uncertainty, and incomplete integrations without ambiguity.
4. Preserve security, accessibility, auditability, and role boundaries as product behavior rather than implementation details.
5. Favor timely, actionable information and resilient workflows over decorative complexity.

## Accessibility & Inclusion

Accessibility is a binding requirement for both the public rider application and the staff console. Interfaces must support keyboard use, visible focus, semantic structure, sufficient contrast, readable and plain language, responsive layouts, and assistive technologies. The exact formal conformance target remains an open decision and must not be invented.
