# 02 — Scope publication is atomic

**What to build:** Every operation that publishes or changes an Event operating
scope either fully succeeds or fully rolls back. An operations administrator who
loses an activation race is refused cleanly and leaves nothing behind; an Event
operating scope snapshot exists if and only if the scope it describes became
operational. This closes the gap between the guarantee already recorded for
scope-snapshot publication and what the code actually does.

Three paths carry the same defect and are fixed together: activation, applying a
reviewed Plan revision, and plan modification.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Activation publishes its scope snapshot, records any Event conflict
      override, and changes plan status inside a single transaction
- [ ] A failed activation leaves no scope snapshot, no conflict override, and
      the plan in its prior status
- [ ] Concurrent activation attempts resolve to exactly one winner; the loser is
      refused and leaves no trace
- [ ] Applying a reviewed Plan revision publishes its scope snapshot inside the
      same transaction as the resource replacement
- [ ] Plan modification creates its revision and copies the plan's resources
      inside a single transaction, so no resource-less revision can survive a
      failure
- [ ] Readiness is read inside the transaction, so it cannot go stale between
      validation and write
- [ ] The existing optimistic status guard is retained as the concurrency
      control; step ordering is otherwise unchanged
- [ ] Verified manually against the development database for all three paths,
      confirming no orphaned rows remain after a forced rollback
- [ ] Console version incremented
