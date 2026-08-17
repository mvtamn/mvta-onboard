# 06 — Stage and next action as codes

**What to build:** A planner sees one clearly stated next action that agrees with
the plan's actual status, and a workflow stage indicator that agrees with the
workspace navigation beside it. The server decides which stage and which next
action apply; the console owns every word shown to the operator.

This retires the three ternary chains in the planning screen that currently
re-derive all of it in the browser.

**Blocked by:** 03 — Server-authoritative Event Plan readiness; 04 — Event Plan
lifecycle module.

**Status:** ready-for-agent

- [ ] Plan reads carry a stage code and a next-action code
- [ ] The next-action vocabulary distinguishes: complete checklist, submit for
      review, approve plan, activate plan, open Event AVL, suspended, and
      completed
- [ ] The vocabulary deliberately omits codes for selecting an Event or creating
      a plan, which describe the absence of a plan and remain workspace state
- [ ] The server emits semantic codes only; all operator-facing copy lives in the
      console, so a terminology change never requires an API deployment
- [ ] The three console ternary chains are replaced by one code-keyed map held
      alongside the existing label maps
- [ ] The map is typed exhaustively, so a console-side code addition cannot
      compile without copy
- [ ] An unrecognized code renders a fallback rather than an empty cell, since
      the two packages have no dependency link and a server-only addition cannot
      be caught at compile time
- [ ] The code vocabulary is mirrored in the shared package with a comment naming
      its server-side counterpart
- [ ] Next-action targets distinguish an in-page anchor from a route navigation,
      retiring the special case that currently guards the Event AVL link
- [ ] The workspace navigation stage and the planning screen stage derive from
      the same server value
- [ ] The domain glossary defines Event Plan next action, mirroring the existing
      Detour equivalent
- [ ] Console version incremented
