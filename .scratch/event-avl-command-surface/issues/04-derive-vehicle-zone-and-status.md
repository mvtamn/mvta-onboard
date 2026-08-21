# 04 — Derive Vehicle zone and status on live positions

**What to build:** An Incident lead can see where every bus is in terms they
authored, not coordinates — and judge which buses are free without any Avail
duty feed.

Each live vehicle reports the **Vehicle zone** it is currently inside and the
**Zone-derived vehicle status** that zone's purpose produces:

| Winning zone purpose | Derived status |
|---|---|
| venue | At venue |
| staging | Staged |
| corridor | In corridor |
| other | In zone |
| none | Outside monitored zones |

A vehicle inside more than one active geofence resolves by purpose precedence,
highest first: venue, staging, corridor, other. **Outside monitored zones**
asserts nothing about what the vehicle is doing — it is not "En route".

Classification is derived per response against the active geofences in the
selected operating scope, reusing the existing point-in-polygon helper rather
than introducing new geometry. It is never persisted. Surface it as a column in
the existing roster; the roster restructure itself is ticket 05.

**Prerequisites:** 01 (extracted roster), 03 (Zone purpose must exist)

**Status:** ready-for-agent

- [ ] A pure classifier returns the winning zone and derived status for a
      vehicle position against a set of geofences, with no database access.
- [ ] Precedence resolves every adjacent pair of purposes deterministically for
      a vehicle inside overlapping fences.
- [ ] A vehicle inside no active geofence reports Outside monitored zones.
- [ ] Inactive geofences, and geofences outside the selected operating scope,
      are ignored.
- [ ] A malformed polygon does not throw and does not fail the response.
- [ ] A vehicle on a polygon boundary resolves deterministically.
- [ ] Zone id, zone name, zone purpose, and derived status are carried on the
      vehicle contract; Scope exceptions inherit them unchanged.
- [ ] No existing contract field changes meaning.
- [ ] The roster shows the zone name and derived status for every vehicle,
      including vehicles that are parked or laying over.
- [ ] Classifier tests follow the prior art of the existing Scope exception
      classifier tests.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
