# 07 — Record the server-authoritative decision

**What to build:** A decision record so a future architecture review does not
propose recalculating Event Plan readiness in the browser, and so the next
reader understands why the code vocabulary is mirrored rather than shared.

**Blocked by:** 03 — Server-authoritative Event Plan readiness; 05 — Shared
plan-to-revision resource copy; 06 — Stage and next action as codes.

**Status:** ready-for-agent

- [ ] A decision record states that Event Plan readiness, workflow stage, and
      next action are computed server-side and rendered verbatim by the console
- [ ] It records the absent shared package and the mirrored code vocabulary as
      the accepted trade-off, including that a server-only code addition is
      caught by a fallback rather than by the compiler
- [ ] It records that the console owns operator-facing copy so terminology
      changes stay frontend-only
- [ ] No change is made to the existing scope-snapshot decision record, whose
      atomicity guarantee the work in 02 now satisfies
- [ ] The record is written after the code work lands, describing what shipped
