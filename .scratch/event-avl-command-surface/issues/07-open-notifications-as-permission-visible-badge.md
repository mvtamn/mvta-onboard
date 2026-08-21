# 07 — Open notifications as a permission-visible badge

**What to build:** Open Event notifications stop competing with the map for the
first viewport, without becoming less visible.

The notification queue becomes a count badge in the sticky context bar that
opens a drawer over the work surface. The badge counts Open Event notifications
— pending, acknowledged, and failed. Acknowledged means seen, not resolved.

The badge renders for every operator, including those who cannot send or dismiss,
preserving the Permission-visible Event alert: awareness is never hidden behind
the permission boundary, and the drawer names the role required for action
rather than omitting the control silently.

The investigative sections — Event message history, Geofence crossings, Event
audit history — and the Teams delivery control move into a collapsed tabbed rail
with counts. Teams delivery keeps its rule that it opens automatically when
delivery is unavailable or an action is blocked.

This is blocked by ticket 02 deliberately: demoting a flooding queue to a badge
hides the flood rather than fixing it.

**Prerequisites:** 02 (the count must be meaningful), 06 (the bar it lives in)

**Status:** ready-for-agent

- [ ] The badge shows the count of open notifications — pending, acknowledged,
      and failed — and opens a drawer with the full queue.
- [ ] Acknowledge, Approve and send, and Dismiss all work from the drawer for
      operators with the required role.
- [ ] The badge and drawer render for read-only operators, and the drawer names
      the role required rather than hiding the notification.
- [ ] Notification actions are paused with an explanation when Event projection
      or crossing detection is degraded, and the roster stays live.
- [ ] Failed delivery remains open work and stays counted.
- [ ] Message history, crossings, and audit are reachable in a collapsed tabbed
      rail with counts, and are not expanded by default.
- [ ] The Teams delivery control shows its current state without opening, and
      opens automatically when delivery is unavailable or blocked.
- [ ] The notification queue no longer occupies the first viewport as a panel.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
