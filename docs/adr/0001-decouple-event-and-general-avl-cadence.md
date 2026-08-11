# ADR 0001: Decouple event and general AVL cadence

## Status

Accepted

## Context

Event monitoring needs a configurable polling cadence so that geofence
crossings can be detected with useful latency. General AVL ingestion serves
other consumers and has its own operational cadence and API-cost profile.

Coupling the two means that tuning event-monitoring precision also changes the
polling cost and freshness behavior of unrelated AVL consumers. That coupling
is surprising from the perspective of an administrator changing event
settings and makes the event module's operational needs leak into the wider
system.

## Decision

Event monitoring and general AVL ingestion will have independent polling
cadences. Event-specific settings must not silently control unrelated AVL
consumers.

The event cadence governs event-participating vehicle data and crossing
detection. General AVL cadence remains controlled by its own operational
policy.

## Consequences

- Event precision can be tuned without changing unrelated AVL freshness.
- AVL API volume becomes easier to reason about per consumer.
- The system must maintain separate scheduling and failure visibility for the
  two ingestion paths.
- Documentation and administration surfaces must identify which cadence each
  setting controls.

## Alternatives considered

- Keep one shared cadence and accept that geofence precision determines
  system-wide polling cost.
- Use a single poll and derive all consumers from it, accepting the same
  coupling in a different form.
