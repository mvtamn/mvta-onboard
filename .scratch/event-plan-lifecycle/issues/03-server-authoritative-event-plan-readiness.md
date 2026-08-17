# 03 — Server-authoritative Event Plan readiness

**What to build:** The activation checklist a planner reads is exactly the one
the server enforces. Today the console recalculates readiness in the browser
from separately-fetched resource lists, so a planner can see a green checklist
and still be refused at activation with a different explanation. The server
already computes readiness on every plan read and discards most of it; this
returns it and has the console render it.

**Blocked by:** 02 — Scope publication is atomic.

**Status:** ready-for-agent

- [ ] Plan reads carry a readiness collection of items, each with a stable
      semantic code and a ready flag
- [ ] The messaging-geofence item carries the identity of the geofence lacking a
      direction rule, so the console's deep link stops being a browser-side
      derivation
- [ ] The console renders server readiness and no longer recalculates it from
      resource lists
- [ ] The operating-dates item follows local edits while the date fields are
      dirty and reverts to the server's value once saved — the only item under a
      client-side rule
- [ ] The Event-selected item remains client-side, since it describes workspace
      state rather than plan state
- [ ] The superseded route-conflict field is removed outright, not aliased
- [ ] A refused activation names the same missing condition the checklist showed
- [ ] Readiness validation keeps its existing tests unchanged
- [ ] Console version incremented
