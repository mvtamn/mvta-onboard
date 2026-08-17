# 04 — Event Plan lifecycle module

**What to build:** One place that answers how an Event Plan moves from draft to
active. Today that progression is encoded in six independent places across two
languages, including five separately hand-written copies of the rule for which
statuses may still be edited — so adding a lifecycle state means editing several
files and trusting they still agree.

A maintainer should be able to read the lifecycle in one module, and a test
should be able to exercise every transition without a database.

**Blocked by:** 02 — Scope publication is atomic.

**Status:** ready-for-agent

- [ ] A pure module owns transition legality, plan editability, Event Planning
      workflow stage derivation, and next-action selection
- [ ] The module holds no database handle and performs no input or output, so
      its interface is the surface both callers and tests use
- [ ] The module also owns the Plan revision state machine, which progresses over
      its own separate statuses
- [ ] Suspension is encoded as terminal, stated by the state machine rather than
      by a code comment
- [ ] Both suspended and completed derive to the activate stage, while resolving
      to distinct next actions
- [ ] The five hand-written editable-status checks collapse to one call
- [ ] The plan action handler becomes a thin dispatcher over the module
- [ ] Tests cover every legal transition, refusal of every illegal one, every
      editability answer, every stage derivation, and every next action —
      exercised through the module's interface, following the existing pure
      decision modules as prior art
- [ ] Console version incremented
