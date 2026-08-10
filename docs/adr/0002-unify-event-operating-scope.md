# ADR 0002: Unify Event operations around one active scope

## Status

Accepted

## Context

Route Classification, map resources, direction rules, Service Plans, Event
AVL, crossing detection, and notifications had drifted into separate scopes.
In particular, AVL projection used `SpecialEvent` classification while
crossing detection used active Service Plan membership, and two UI surfaces
offered competing Service Plan workflows.

## Decision

An Event is the durable operating anchor. It owns one active Service Plan at a
time; a Service Plan represents one MVTA-local operating period and is the
only executable scope for Event AVL, Event Monitoring, crossing detection,
and notifications. Route Classification remains reusable reference data and
does not activate monitoring.

Event Planning is the sole lifecycle owner: draft → review → approved → active
→ completed, with suspension and reviewed revisions for active plans. Event
Map Authoring maintains reusable, versioned geofences, locations, and direction
rules but cannot create or activate plans. Activation atomically validates
routes, pinned resources, rule coverage, local dates, and route conflicts.

Operational consumers use one shared scope contract. Vehicles outside an
active scope remain available as unplanned diagnostics, but do not generate
crossings or notifications. A shared AVL ingestion path remains the only
upstream Avail poll; Event projection consumes its state.

## Consequences

- Event Monitoring has one unambiguous operational context.
- Unplanned vehicles remain visible without becoming operational participants.
- Active scopes are reproducible because revisions pin resource versions.
- Existing Service Plans migrate beneath generated Events without inventing
  historical Event details.
- The current separate classification/live-map and plan/crossing predicates
  must be replaced by the shared scope contract.
