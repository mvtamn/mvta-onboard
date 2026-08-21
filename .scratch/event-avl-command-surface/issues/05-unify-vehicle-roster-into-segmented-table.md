# 05 — Unify the vehicle roster into one segmented table

**What to build:** An Incident lead reads one vehicle table instead of two.

Today the same vehicles render twice — once in the Scope exceptions disclosure
and again in the full active-vehicle table — so scanning means reading the same
buses under two headings. Replace both with a single table carrying two
segments:

1. **In this operating period** — vehicles in active scope
2. **Event-relevant, outside this period** — the existing Scope exception set,
   keeping its category, evidence, and proposal state

Within each segment, order by attention descending, built **only** from domain
terms that already exist: Scope exceptions first by their established category
precedence, then Stale Event vehicle position, then by vehicle number. No new
classification concept is invented to make the roster scannable.

Default columns are Vehicle, Status, Zone, Route, Last report. Operator, block,
run, speed, and service plan move to the expanded row, because they are commonly
unavailable from the upstream feeds and should not hold width when empty.

Scope exception remains a statement about plan membership, not operational
trouble — it must not be conflated with Zone-derived vehicle status.

**Prerequisites:** 01 (extracted roster), 04 (Zone is a default column)

**Status:** ready-for-agent

- [ ] One table replaces the separate Scope exceptions table and active-vehicle
      table; no vehicle appears twice.
- [ ] Both segments render with their own counts, and the counts agree with the
      summary counts because they derive from the same source.
- [ ] Scope exceptions keep their category label, evidence, and proposal state.
- [ ] The Propose scope change action still appears for operators with
      Administrator access, on exceptions that are action eligible, and still
      hands off to Event Planning with the same context.
- [ ] Read-only operators can inspect exception evidence and proposal state but
      see no proposal action.
- [ ] Attention ordering puts Scope exceptions first by category precedence,
      then stale vehicles, then the rest.
- [ ] Default columns are Vehicle, Status, Zone, Route, Last report; the rest
      are reachable by expanding a row.
- [ ] A stale vehicle is visibly marked and does not support a "reporting now"
      claim.
- [ ] A successful empty result renders as a distinct No results state, not as
      loading or unavailable.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
