# Event Plan lifecycle deepening

## Problem Statement

Operations staff working in Event Planning see a workspace that sometimes
contradicts itself. A suspended Event Plan displays a banner saying monitoring
is paused while the same screen's next action says the plan is completed. The
activation checklist a planner reads is calculated by the browser from
separately-fetched resource lists, so it can disagree with the checklist the
server actually enforces — a planner can see a green "ready to activate" and
still be refused at activation, with a different explanation than the one on
screen.

Underneath, activation is not atomic despite the decision recorded in ADR-0014.
Publishing an Event operating scope snapshot, recording an Event conflict
override, and flipping the plan to active are three unsynchronized writes. When
two administrators act at once, the loser is told the plan was not approved,
but the snapshot and override rows it wrote remain behind, leaving stored scope
history that corresponds to no activation. The same defect exists on the path
that applies a reviewed Plan revision.

For maintainers, every change to the Event lifecycle costs more than it should.
The progression from draft to active is encoded in six independent places
across two languages — a UI step list, two ternary chains, a workspace
navigation stage list, the backend transition maps, and five separately
hand-written copies of the rule for which statuses may still be edited.
Readiness rules are written twice. Nothing ties any of these copies together,
so adding one readiness rule or renaming one lifecycle stage means editing
several files and trusting that they still agree.

## Solution

Make the server authoritative for Event Plan readiness, workflow stage, and
next action, and have Event Planning render those answers rather than
recalculating them.

Introduce one deep module that owns the Event lifecycle: which transitions are
legal, which statuses are editable, which stage of the Event Planning workflow
a status belongs to, and which next action an operator should be offered. The
module is pure — it accepts a plan status and its readiness and returns
decisions — so its interface is the surface both callers and tests use.

Make activation and revision application atomic, matching the guarantee
ADR-0014 already claims, so an Event operating scope snapshot exists if and
only if the scope it describes became operational.

The result for planners is a single, trustworthy activation checklist and a
next action that never contradicts the plan's state. The result for
maintainers is that a new readiness rule, a renamed stage, or a new lifecycle
state is a change in one place instead of six.

## User Stories

1. As an Event planner, I want the activation checklist to show exactly the
   conditions the server enforces, so that I am never told a plan is ready and
   then refused at activation.
2. As an Event planner, I want a refused activation to explain the same
   missing condition the checklist showed, so that I do not have to reconcile
   two different accounts of the same problem.
3. As an Event planner, I want the checklist item for operating dates to
   update as I type, so that I can correct an invalid operating period without
   saving first.
4. As an Event planner, I want every other checklist item to reflect saved
   state, so that I am not misled by resource counts the server has not seen.
5. As an Event planner, I want the checklist to name which linked geofence is
   missing a direction rule, so that I can navigate straight to the resource
   that needs authoring.
6. As an Event planner, I want one clearly stated next action for the plan I
   am looking at, so that I know what to do without interpreting the lifecycle
   myself.
7. As an Event planner working on a suspended Event Plan, I want the next
   action to say the plan is suspended, so that the screen does not tell me it
   is completed.
8. As an Event planner, I want the workflow stage indicator to agree with the
   plan's actual status, so that the Plan, Configure, Review, and Activate
   progression is trustworthy.
9. As an Event planner, I want the workspace navigation to highlight the same
   stage the planning screen shows, so that two parts of the same page do not
   disagree.
10. As an Event planner, I want a plan with no Event selected to prompt me to
    select one, so that the workspace starts from a focused empty state.
11. As an Event planner, I want an Event with no plan to prompt me to create
    one, so that I am not shown planning controls for a plan that does not
    exist.
12. As an authorized reviewer, I want review evidence to reflect
    server-computed readiness, so that what I approve is what activation will
    enforce.
13. As an authorized reviewer, I want the Event conflict override reason to be
    required by the same rule at review and at activation, so that an override
    accepted at one gate is not rejected at the next.
14. As an operations administrator, I want activation to either fully publish
    or fully fail, so that a partially published Event operating scope
    snapshot can never exist.
15. As an operations administrator, I want a lost activation race to leave no
    trace, so that stored scope snapshots always correspond to a real
    activation.
16. As an operations administrator, I want a recorded Event conflict override
    to be discarded when its activation fails, so that the audit does not show
    an override for an activation that never happened.
17. As an operations administrator, I want applying a reviewed Plan revision
    to be atomic, so that a reviewed scope change publishes completely or not
    at all.
18. As an operations administrator, I want concurrent activation attempts to
    resolve to exactly one winner, so that two administrators cannot both
    believe they activated the plan.
19. As an operations administrator, I want a failed activation to leave the
    plan in its prior status, so that I can retry from a known state.
20. As an Incident lead relying on Event AVL, I want published scope to
    correspond to an active plan, so that live monitoring never reads a
    snapshot for a plan that is not operational.
21. As a read-only user, I want to see the same readiness and next action as
    an editor, so that I understand the plan's state without being able to
    change it.
22. As an Event planner, I want plan editability to be enforced consistently
    across plan fields, resource links, revisions, and resource deletion, so
    that one surface does not permit an edit another forbids.
23. As an Event planner, I want an attempt to edit an active plan to direct me
    to the reviewed scope change path, so that I understand direct mutation is
    not allowed.
24. As a maintainer, I want the Event lifecycle expressed in one module, so
    that I can read how a plan reaches active without tracing six encodings.
25. As a maintainer, I want the lifecycle module to be pure, so that I can
    test every transition and next action without a database.
26. As a maintainer, I want the rule for editable statuses to exist once, so
    that adding a lifecycle state cannot leave one surface behind.
27. As a maintainer, I want readiness computed once on the server, so that a
    new readiness rule is a single change rather than a coordinated edit in
    two languages.
28. As a maintainer, I want the frontend to hold user-facing copy and the
    server to hold semantic codes, so that a terminology change never requires
    a backend deployment.
29. As a maintainer, I want the frontend's copy map to be exhaustive over the
    code vocabulary, so that adding a code without copy fails to compile.
30. As a maintainer, I want an unrecognized code to render a safe fallback, so
    that a backend-only addition degrades rather than showing an empty cell.
31. As a maintainer, I want the duplicated plan-to-revision resource copy to
    exist once, so that a fix to it cannot be applied to one caller and missed
    on the other.
32. As a maintainer, I want the shared resource copy to participate in its
    caller's transaction, so that callers that already manage atomicity are
    not forced to nest or split transactions.
33. As a maintainer, I want the lifecycle module to state that suspension is
    terminal, so that the constraint is expressed in the state machine rather
    than a code comment.
34. As a maintainer, I want the domain glossary to describe suspension
    accurately, so that the next reader does not assume a resume path exists.
35. As a maintainer, I want the new next-action vocabulary defined in the
    domain glossary, so that it is named consistently with the equivalent
    Detour concept.
36. As a maintainer, I want the atomicity correction isolated in its own
    change, so that a correctness fix can be reviewed and reverted
    independently of a refactor.
37. As a maintainer, I want each change to bump the console version, so that a
    production symptom can be correlated to a specific deployable change.
38. As a maintainer, I want the superseded route-conflict field removed rather
    than aliased, so that there is one name for the conflict condition.
39. As a maintainer, I want an architectural decision record for
    server-authoritative readiness, so that a future review does not propose
    recalculating it in the browser.

## Implementation Decisions

### Event Plan lifecycle module

A new pure module, `eventPlanLifecycle`, becomes the single owner of Event
lifecycle semantics. It holds no database handle and performs no input or
output. It exposes four functions and the types they operate on:

```ts
type EventPlanStatus = "draft"|"review"|"approved"|"active"|"suspended"|"completed";
type EventPlanAction = "submit-review"|"approve"|"advance"|"complete"|"suspend";
type EventPlanStage  = "plan"|"configure"|"review"|"activate";
type EventPlanNextAction =
  | "complete_checklist" | "submit_review" | "approve_plan"
  | "activate_plan" | "open_event_avl" | "plan_suspended" | "plan_completed";

transitionFor(action): { from, to } | null
isPlanEditable(status): boolean
stageForStatus(status): EventPlanStage
nextActionFor({ status, ready }): EventPlanNextAction
```

The module also owns the Plan revision state machine, which is a separate
progression (draft, review, approved, rejected, applied) over different
statuses.

The next-action vocabulary deliberately excludes codes for selecting an Event
or creating a plan. Those describe the absence of a plan, which is client-side
workspace state the server is never asked about.

`stageForStatus` maps both suspended and completed to the activate stage,
since both are past activation. `nextActionFor` distinguishes them, which is
what resolves the current contradiction between the suspension banner and the
next action.

Suspension is encoded as terminal. There is no transition out of it today —
neither resume nor complete is reachable — and the module states this rather
than leaving it to a comment. Adding an exit is deliberately excluded from
this work.

### Readiness as a server-owned contract

Readiness validation stays in its existing module. It is an input to lifecycle
decisions, not part of the state machine, and it retains its own tests.

The plan read response gains a readiness collection: a list of items, each
carrying a stable semantic code, a ready flag, and optional evidence. The
messaging-geofence item carries the identifier of the geofence lacking a
direction rule, so the console's deep link stops being a client-side
derivation.

The superseded route-conflict boolean is removed outright rather than retained
as an alias. It has three consumers, all inside the screen being changed, and
the interface is internal with no external clients.

Readiness is already computed server-side on every plan read; this exposes
what is currently discarded rather than adding new work at the data layer.

### Stage and next action on the wire

The plan read response also gains a stage code and a next-action code. The
server emits semantic codes; the console owns all user-facing copy through a
lookup keyed by those codes, held alongside the existing label maps in the
shared package.

This follows the dominant precedent in the codebase — enum from the server, a
label map in the console — rather than the outlier pattern where a server
emits finished prose and the console carries duplicate literals as fallbacks.
It also keeps terminology changes confined to the frontend.

Because the API package and the console package have no dependency link, the
console cannot import the server's code union. The union is mirrored in the
shared package with a comment naming its counterpart, and the copy map is
typed as an exhaustive record so a console-side addition cannot compile
without copy. An unrecognized code renders a fallback, since nothing short of
a shared package catches a server-only addition.

The next-action target becomes a discriminated union distinguishing an
in-page anchor from a route navigation, which retires the special case that
currently guards the Event AVL link before scrolling.

### Checklist composition in the console

The rendered checklist combines three sources. The server supplies its items
in order. The console prepends the Event-selected item, which describes
workspace state rather than plan state. The server always supplies the
operating-dates item, and the console overrides only that item's ready flag
while the date fields are dirty, falling back to the server's value once
saved. This keeps exactly one item under a client-side rule.

### Atomicity of scope publication

Activation and revision application each become one transaction. The existing
optimistic status guard is retained as the concurrency control; when it
affects no rows the transaction rolls back and the request is refused. The
readiness read moves inside the transaction so validation cannot go stale
between checking and writing.

The readiness read and the scope snapshot capture change signature to accept a
transaction rather than a connection pool. The step ordering is otherwise
unchanged, to keep the correctness fix reviewable as a correctness fix.

### Shared resource copy

The two identical plan-to-revision resource copies — one in the plan
modification path, one in the vehicle assignment approval path — collapse into
a single function that accepts the caller's transaction. The plan repair copy
and the revision application copy are left alone: they move resources in
different directions with different semantics, and folding all four behind a
direction parameter would produce a shallow module whose parameters encode the
differences it is supposed to hide.

### Lifecycle handler

The multiplexing action handler becomes a thin dispatcher over the lifecycle
module. The five separately hand-written copies of the editable-status rule
collapse to a single call.

### Sequencing

The work lands as four changes on a branch taken from the main branch, in this
order, each independently reviewable:

1. Atomicity of activation and revision application.
2. Readiness on the plan read response, and removal of the superseded
   route-conflict field.
3. The lifecycle module, the thin dispatcher, and the shared resource copy.
4. Stage and next action on the response, and the console copy map replacing
   the three ternary chains.

The console version is incremented on each of the four, including the two that
change only server behavior, so that every deployable change advances the
version.

### Domain and decision records

The domain glossary gains an Event Plan next action entry, mirroring the
existing Detour equivalent. The active-scope suspension entry is corrected: it
currently describes resume and complete exits that are not reachable, and will
instead describe suspension as terminal with the missing exits named as known
gaps.

An architectural decision record for server-authoritative Event Plan readiness
and next action is written after the work lands. ADR-0014 requires no change —
the atomicity work makes the implementation match what that record already
states.

## Testing Decisions

A good test here exercises external behavior through a module's interface and
says nothing about how the module is organized internally. Tests should assert
what a caller can observe: which transition is legal from a status, which next
action an operator is offered, whether a readiness condition is met. They
should not assert the shape of internal branching.

### Preferred seam

The Event Plan lifecycle module's interface is the single seam for this work,
and it is deliberately the highest available one. Because the module is pure
and holds no database handle, every lifecycle decision — transition legality,
editability, stage derivation, next-action selection, and the revision state
machine — is reachable through four functions with plain arguments. This is
also why the module is specified as pure: a database-aware module would push
verification below the interface, where the existing test runner cannot reach.

This seam already exists in form. The project's convention is pure decision
modules under the API package's library directory, tested by a runner that
executes only compiled library tests. The readiness validation module, the
scope classification module, the direction rule module, and the assignment
target module are all prior art for exactly this shape, and the new module's
tests follow them directly.

No new seam is proposed for the server. Adding one would mean introducing test
infrastructure that does not exist today.

### What gets tested at that seam

- Every legal transition, and refusal of every illegal one.
- Editability for each status, replacing five hand-written copies of the rule.
- Stage derivation for each status, including suspended and completed both
  resolving to the activate stage.
- Next-action selection for each status, specifically that suspended and
  completed resolve to different codes — this is the regression test for the
  contradiction being fixed.
- Revision state machine transitions, including the applied terminal state.
- That suspension is terminal, asserted directly rather than left implicit.

Readiness validation keeps its existing tests unchanged, since that module is
not being restructured.

### Console seam

Console coverage uses the existing screen-level tests for Event Planning,
which already render the workspace against fixture plan data. Those fixtures
change shape — a readiness collection and stage and next-action codes replace
the route-conflict boolean — and the assertions shift from checking a
browser-derived checklist to checking that server-supplied readiness is
rendered faithfully.

Two behaviors warrant explicit console tests: that the operating-dates item
follows local edits while the form is dirty and reverts to the server's value
once saved, and that an unrecognized next-action code renders the fallback
rather than an empty cell.

The exhaustive record typing of the copy map is enforced by the compiler
rather than by a test.

### Atomicity verification

The atomicity change cannot be covered at any existing seam. The test runner
executes only pure library tests, and nothing in the project exercises SQL.
Verification is manual against the development database, using the existing
development database tooling: force a rollback during activation and confirm
no scope snapshot row and no conflict override row remain, and confirm the
plan's status is unchanged.

Standing up integration test infrastructure is worthwhile but is a separate
undertaking, and bundling it here would convert a small correctness fix into a
test infrastructure change.

## Out of Scope

- **A resume path out of suspension.** Suspension is terminal today. Adding an
  exit is a workflow feature carrying its own questions — who holds the
  authority to resume, whether activation validation re-runs, whether a fresh
  scope snapshot publishes — and must not be introduced as a side effect of a
  refactor.
- **The per-plan readiness query pattern.** Plan reads run one readiness query
  per plan. Stage and next action ride along on the existing query rather than
  adding new ones. Rewriting this is pre-existing performance work and would
  obscure the refactor.
- **Integration test infrastructure.** See Testing Decisions.
- **Sharing a compiled module between the API and console packages.** The two
  are separate packages with no dependency link. The API response is the seam;
  introducing a shared package was considered and rejected.
- **Renumbering the colliding decision records.** Two records are numbered
  0021 and two are numbered 0022. This is real housekeeping but belongs in its
  own change; the Event Plan planning boundary record keeps 0022.
- **Routing Event Planning's SpecialEvent checks through the shared scope
  predicate.** A separate identified opportunity, deferred.
- **Extracting confirmation dialogs and scope summary derivation from the
  planning screen.** A separate identified opportunity, deferred.
- **Retiring the unused plan advance wrapper and typing the published scope
  serializer.** A separate identified opportunity, deferred.

## Further Notes

The three problems this spec addresses were identified as separate
opportunities but share one root: the console re-derives what the server
already knows, and the lifecycle has no single owner. Treating them as one
change is what allows the lifecycle module to absorb all six encodings at
once; done separately, each would establish a partial owner and the
duplication would persist in a different arrangement.

The editable-status rule was not part of the original assessment. It surfaced
while reading the handler in full and is the highest-leverage item in the set:
five call sites collapse to one function, and it is the duplication most
likely to drift silently, since nothing currently connects the five copies.

The precedent for server-authoritative readiness is the Detour workflow, but
that precedent is internally inconsistent and should be followed selectively.
It computes readiness as a semantic code that the console maps to prose, and
in the same response emits next action and owner as finished prose that the
console prints directly — with hardcoded fallbacks duplicating the server's
literals. The coded half is the pattern to follow; the prose half already
exhibits the drift this work exists to remove.

The suspension contradiction is a live operator-facing defect, not only a
structural concern. The planning screen currently renders a suspension banner
and a completed next action simultaneously for the same plan.
