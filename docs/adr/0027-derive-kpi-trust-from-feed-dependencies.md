# Derive KPI trust from feed dependencies

**Status:** accepted

Each feed-backed operational KPI exposes a derived KPI trust state rather than
asking an operator to infer currency from an empty result, a connection check,
or a raw feed log. The state is calculated centrally from the KPI's declared
required and supporting feed dependencies, their Delivery freshness, and their
Data coverage.

A required dependency that is stale or unavailable makes only its associated
KPI source stream Stale. Supporting dependencies may explain reduced context
but do not invalidate the stream. Compound KPIs retain a separate state for
each source stream, so a stale Spare stream does not hide a current fixed-route
stream. A successful run with no qualifying records is Current-but-empty, not
Stale.

The initial dependency map and Freshness contracts are visible in an Admin KPI
trust view and remain fixed in the first release. The implementation uses one
shared, PII-free projection over existing ingestion health records; it does not
introduce a separate monitoring platform, client-side probes, or vendor calls
from the UI. Real-time initial lateness limits are three missed cycles: 15
minutes for GTFS, 2 minutes for AVL, and 45 minutes for Spare reconciliation.
Operations must approve periodic-source reporting deadlines before daily or
monthly streams automatically enter Stale.

Stale source data remains visible as last-known context, but it cannot support
automatic Suggested Alerts or assessment promotion. A staff member may make a
manual communication using that context only after creating a
Stale-data acknowledgement record that names the affected KPI source stream,
the staff member, timestamp, and reason. The record never changes the trust
state. Administrators own dependency and contract policy; dispatch/OCC staff
may create acknowledgements only.
