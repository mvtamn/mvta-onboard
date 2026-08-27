# Reconcile Spare live-risk state after webhook updates

On-demand service quality accepts authenticated, non-PII Spare lifecycle, ETA, vehicle-location, and duty-matching events for low-latency visibility, but an hourly reconciliation remains authoritative. Newer source state alone may update an active request; each evaluation retains its policy and zone snapshots so webhook retry, rescheduling, GTFS-Flex changes, and later policy edits cannot rewrite historical results.
