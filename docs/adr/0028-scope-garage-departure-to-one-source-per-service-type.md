# Scope garage departure to one source per service type

**Status:** accepted

**Garage departure** is one concept: the departure of an assigned vehicle from
its garage or start location, measured as the variance between its scheduled
and actual departure. It is a single operational idea with two feeds behind it,
not two metrics that happen to share a name.

Avail's Pullout Reports (`FixedRouteDepartures`, migration 013) are
authoritative for fixed route. They are dispatch-side records carrying Avail's
own `pullout_status` classification, they are keyed by
`(service_date, block, run)`, and they are already the sole input to the
`GARAGE_DEPARTURE` contractor-performance standard. Spare's `startLocation`
slot, at duty grain, is the source for on-demand duties when the deferred Spare
garage-departure work described in `plans/onboard-spare-integration-spec.md` is
taken up. No departure is ever measured from both feeds: the service type
selects the source, and a departure with no source for its service type is
absent rather than inferred from the other one.

This supersedes that spec's §6.1 proposal to link fixed-route missed trips to
garage delay through Spare's `garage_departure_metrics`. Fixed-route garage
delay comes from `FixedRouteDepartures`, which is what `complianceCandidatesPoll`
already does. Its open item 12 — which field distinguishes fixed-route from
on-demand rows in Spare — stops being a build blocker and becomes a guard: if
Spare duties turn out to cover fixed-route service, those duties stay out of the
compliance path, because Avail already measures them.

A compliance occurrence raised from a garage departure must carry its source
system in `source_ref`, the way the missed-trip candidate MERGE in
`complianceCandidatesPoll` already does with `source_system`. The garage
departure MERGE currently emits a bare `FixedRouteDepartures:` reference with no
source discriminator and no per-source gate. Adding a second feed without that
shape would let one physical departure raise two occurrences against the same
scored standard.

Delay reason belongs to the concept, not to a feed. It is operator-entered in
OnBoard because neither Avail nor Spare carries it, so it attaches to the
garage-departure record whichever source measured the departure.
