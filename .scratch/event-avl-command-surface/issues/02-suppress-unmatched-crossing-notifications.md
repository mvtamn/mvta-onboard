# 02 — Suppress unmatched crossing notifications

**What to build:** Today every geofence crossing creates a notification,
including ones that match no configured direction rule, with no dedup or
expiry — so the open-notification queue fills with movement nobody asked to be
told about. Make a crossing raise a notification only when it matches a
configured direction rule.

An Unmatched crossing is still detected, still recorded, and still visible in
the Geofence crossings section as investigative evidence. It simply stops
creating operational work. This makes the open-notification count mean "a rule
author intended this to be seen", which is a precondition for demoting
notifications to a badge in ticket 07.

Notification cooldown is explicitly **not** in scope. It exists in the glossary
and is implemented nowhere; it remains the correct long-term answer and should
follow separately.

**Prerequisites:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A crossing matching a configured direction rule creates a notification
      exactly as it does today, preserving manual and auto send modes.
- [ ] A crossing matching no direction rule creates no notification.
- [ ] An Unmatched crossing is still written to the crossing record and still
      appears in the Geofence crossings section with its transition and
      geofence.
- [ ] The Event audit history still reflects unmatched crossings.
- [ ] Detection failure remains caught and non-fatal to the ingestion run.
- [ ] Tests cover matched and unmatched crossings at the detection seam,
      following the prior art in the existing geofence and direction-rule
      tests.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
