# Detect fast Monitoring Area crossings from qualified GPS paths

**Status:** accepted

Event AVL will infer a boundary movement when the straight path between two
consecutive GPS reports intersects a Monitoring Area boundary. This prevents a
fast vehicle from passing through a small area between polls without a
recorded movement, while retaining a 25-metre minimum displacement and a
two-effective-poll-interval interpolation window to limit GPS-noise and
late-report false positives.

## Consequences

An outside-to-outside path through an area records independent enter and exit
movements, including crossings into or out of excluded area holes. Each
movement evaluates its own direction rule and uses the confirming report's
timestamp as its detected time. Every movement remains auditable with its
detection method, source timestamps, and displacement; Teams delivery is
suppressed for 60 seconds only for the same vehicle, operating plan,
Monitoring Area, and movement type.
