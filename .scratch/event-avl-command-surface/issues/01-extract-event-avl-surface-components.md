# 01 — Extract Event AVL surface components

**What to build:** No operator-visible change. The Event AVL route currently
renders every band inline in one component — summary, context selectors, scope
strip, health strip, notification queue, map, roster, and investigative
sections. Pull the vehicle roster, the context/summary bands, and the map pane
into separately renderable pieces so the desk surface and the later field view
share them rather than duplicating them.

Pin current behaviour with rendered tests *before* extracting, so the slices
that follow have a safety net. This is a prefactor: make the change easy, then
make the easy change.

**Prerequisites:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A rendered test seam exists for the Event AVL route, following the prior
      art in the console's existing rendered module tests.
- [ ] Tests cover current behaviour before extraction: context selection, the
      scope and health strips, the notification queue, the roster, and the
      Scope exceptions disclosure.
- [ ] Roster, context/summary bands, and map pane are separately renderable
      without the full route mounting them.
- [ ] Extracted pieces take their data as inputs rather than reaching for
      workspace or auth context directly, so the field view can reuse them.
- [ ] No change to rendered output, operator-facing copy, roles, or trust
      states. The existing Event AVL tests and the pure monitoring-state tests
      still pass unchanged.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
