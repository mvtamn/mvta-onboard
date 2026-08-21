# 08 — Event AVL field view

**What to build:** A field lead on a tablet gets a surface built for the job in
front of them — where are my buses — instead of a desk console flattened into
one scrolling column.

The **Event AVL field view** is a separate reduced surface, not a responsive
breakpoint. It carries the live map, a vehicle list grouped by Vehicle zone,
tap-to-select vehicle detail, feed freshness, and the open-notification badge.

It deliberately omits geofence crossings, Event audit history, Event message
history, the Teams delivery control, Scope exceptions and their proposal
actions, and Event Planning links. Those are desk work: proposing a scope change
is a planning review decision, not a parking-lot one.

The badge counts Open Event notifications only. Teams remains the record of what
was delivered, so a field lead with Teams access still needs the badge to see
work the desk has not actioned yet.

The desk surface is unchanged by this ticket.

**Prerequisites:** 01 (shared pieces), 04 (Vehicle zone grouping), 07 (the badge)

**Status:** ready-for-agent

- [ ] The field view is reachable as its own surface, permission-scoped like the
      desk surface.
- [ ] It renders the map, a zone-grouped vehicle list, feed freshness, and the
      open-notification badge.
- [ ] Vehicles group by Vehicle zone, including an Outside monitored zones
      group.
- [ ] Tapping a vehicle on the map or in the list opens its detail.
- [ ] Touch targets are sized for a tablet, and no operator-facing information
      is reachable only by hover.
- [ ] Crossings, audit, message history, Teams delivery, Scope exceptions, and
      Planning links do not appear.
- [ ] Feed freshness and stale vehicles are marked as clearly as on the desk
      surface, so a poor connection is not mistaken for a quiet event.
- [ ] Trust states behave as on the desk surface: a successful empty result is a
      distinct No results state, and an expired session produces one recovery
      state rather than empty content.
- [ ] The desk surface renders unchanged.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
